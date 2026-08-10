import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { APP_ROOT } from './paths.mjs';
import { extractJpeg } from './ffmpeg.mjs';

const SCHEMA_PATH = path.join(APP_ROOT, 'config', 'death-analysis.schema.json');
const LOCAL_CODEX_COMMAND = path.join(APP_ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'codex.cmd' : 'codex');
const CODEX_COMMAND = process.env.CODEX_PATH || (existsSync(LOCAL_CODEX_COMMAND) ? LOCAL_CODEX_COMMAND : 'codex');
const BATCH_SIZE = 3;
const CACHE_VERSION = 1;
const ANALYSIS_ENABLED = process.env.CODEX_DEATH_ANALYSIS === 'true';
const FORCE_REFRESH = process.env.CODEX_DEATH_ANALYSIS_REFRESH === 'true';
const CODEX_MODEL = process.env.CODEX_DEATH_MODEL || '';
const CODEX_TIMEOUT_MS = Math.max(10_000, Number(process.env.CODEX_DEATH_TIMEOUT_MS) || 180_000);
let availabilityPromise = null;

export function runCodex(args, { input = '', timeoutMs = 180_000 } = {}) {
  return new Promise((resolve, reject) => {
    const childEnvironment = { ...process.env };
    // This feature is intentionally subscription-backed. Never let an API key
    // in the parent shell silently switch death analysis to API billing.
    delete childEnvironment.OPENAI_API_KEY;
    const child = spawn(CODEX_COMMAND, args, {
      cwd: APP_ROOT,
      env: childEnvironment,
      windowsHide: true,
      shell: process.platform === 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '', settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error('Codex analysis timed out'));
    }, timeoutMs);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => finish(error));
    child.on('close', code => code === 0
      ? finish(null, { stdout, stderr })
      : finish(new Error(`Codex exited with ${code}: ${stderr.slice(-1000)}`)));
    child.stdin.end(input);
  });
}

export async function codexAvailable() {
  availabilityPromise ||= runCodex(['login', 'status'], { timeoutMs: 10_000 })
    .then(({ stdout, stderr }) => /logged in using chatgpt/i.test(`${stdout}\n${stderr}`))
    .catch(() => false);
  return availabilityPromise;
}

export function normalizeCodexAnalysis(value, expectedIds) {
  if (!value || !Array.isArray(value.deaths)) return [];
  const seen = new Set();
  return value.deaths.flatMap(item => {
    if (!expectedIds.has(item?.id) || seen.has(item.id)) return [];
    if (!['title', 'situation', 'cause'].every(key => typeof item[key] === 'string' && item[key].trim())) return [];
    seen.add(item.id);
    return [{
      id: item.id,
      title: item.title.trim().slice(0, 120),
      situation: item.situation.trim().slice(0, 600),
      cause: item.cause.trim().slice(0, 600),
    }];
  });
}

async function cacheSignature(clipPath, deaths) {
  const stat = await fs.stat(clipPath);
  return createHash('sha256').update(JSON.stringify({
    version: CACHE_VERSION,
    clip: { size: stat.size, modified: stat.mtimeMs },
    deaths: deaths.map(({ id, time, end }) => ({ id, time, end })),
  })).digest('hex');
}

async function readCache(cachePath, signature, expectedIds) {
  if (FORCE_REFRESH) return [];
  try {
    const cache = JSON.parse(await fs.readFile(cachePath, 'utf8'));
    if (cache.version !== CACHE_VERSION || cache.signature !== signature) return [];
    const analyses = normalizeCodexAnalysis(cache, expectedIds);
    return analyses.length === expectedIds.size ? analyses : [];
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return [];
    throw error;
  }
}

async function analyzeBatch({ clipPath, deaths, frameDir, batchIndex }) {
  const images = [];
  for (const death of deaths) {
    const before = path.join(frameDir, `${death.id}-before.jpg`);
    const after = path.join(frameDir, `${death.id}-after.jpg`);
    await extractJpeg(clipPath, Math.max(0, death.time - 1.25), before, 960);
    await extractJpeg(clipPath, death.time + 1.25, after, 960);
    images.push(before, after);
  }
  const outputPath = path.join(frameDir, `result-${batchIndex}.json`);
  const imageGuide = deaths.map(death =>
    `- ${death.id}: ${path.basename(`${death.id}-before.jpg`)} はデス1.25秒前、${path.basename(`${death.id}-after.jpg`)} はデス1.25秒後`).join('\n');
  const prompt = `スプラトゥーン3の試合映像から、自分の各デスを日本語で分析してください。
添付画像の対応:
${imageGuide}

各デスについて次だけを返してください。
- title: 何によって、またはどのように倒されたかを短く。画像で特定できなければ断定しない。
- situation: デス直前に自分が何をしており、周囲がどうだったか。
- cause: デスにつながった直接的な要因。改善案や教訓は書かない。

画面で確認できた事実と推測を分け、ブキ名・攻撃方法・敵位置が読めない場合は「特定できない」と明記してください。各idを必ずそのまま返してください。`;
  const args = [
    'exec', '--sandbox', 'read-only', '--skip-git-repo-check',
    '--image', ...images,
    '--output-schema', SCHEMA_PATH,
    '--output-last-message', outputPath,
  ];
  if (CODEX_MODEL) args.push('--model', CODEX_MODEL);
  args.push('-');
  await runCodex(args, { input: prompt, timeoutMs: CODEX_TIMEOUT_MS });
  return normalizeCodexAnalysis(JSON.parse(await fs.readFile(outputPath, 'utf8')), new Set(deaths.map(death => death.id)));
}

export async function analyzeDeathsWithCodex({ clipPath, deaths, workDir, matchNumber }) {
  if (!deaths.length || !ANALYSIS_ENABLED) return deaths;
  const frameDir = path.join(workDir, 'codex-deaths', `match-${String(matchNumber).padStart(2, '0')}`);
  await fs.mkdir(frameDir, { recursive: true });
  const cachePath = path.join(frameDir, 'analysis-cache.json');
  const expectedIds = new Set(deaths.map(death => death.id));
  try {
    const signature = await cacheSignature(clipPath, deaths);
    const cached = await readCache(cachePath, signature, expectedIds);
    if (cached.length) {
      const byId = new Map(cached.map(item => [item.id, item]));
      return deaths.map(death => ({ ...death, ...byId.get(death.id), analysisSource: 'codex-vision-cache' }));
    }
    if (!(await codexAvailable())) return deaths;
    const analyses = [];
    for (let index = 0; index < deaths.length; index += BATCH_SIZE) {
      analyses.push(...await analyzeBatch({
        clipPath,
        deaths: deaths.slice(index, index + BATCH_SIZE),
        frameDir,
        batchIndex: Math.floor(index / BATCH_SIZE) + 1,
      }));
    }
    if (analyses.length !== deaths.length) throw new Error(`Codex returned ${analyses.length}/${deaths.length} death analyses`);
    await fs.writeFile(cachePath, `${JSON.stringify({ version: CACHE_VERSION, signature, deaths: analyses }, null, 2)}\n`);
    const byId = new Map(analyses.map(item => [item.id, item]));
    return deaths.map(death => {
      const analysis = byId.get(death.id);
      return analysis ? { ...death, ...analysis, analysisSource: 'codex-vision' } : death;
    });
  } catch (error) {
    availabilityPromise = Promise.resolve(false);
    console.warn(`Codex death analysis unavailable; using automatic fallback: ${error.message}`);
    return deaths;
  }
}
