import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { APP_ROOT, STAGE_MAP_ROOT } from './paths.mjs';
import { extractJpeg } from './ffmpeg.mjs';
import { codexAvailable, runCodex } from './codex-death-analysis.mjs';

const SCHEMA_PATH = path.join(APP_ROOT, 'config', 'stage-analysis.schema.json');
const CACHE_VERSION = 2;
const BATCH_SIZE = 8;
const ANALYSIS_ENABLED = process.env.CODEX_STAGE_ANALYSIS !== 'false';
const CODEX_MODEL = process.env.CODEX_STAGE_MODEL || '';
const CODEX_TIMEOUT_MS = Math.max(10_000, Number(process.env.CODEX_STAGE_TIMEOUT_MS) || 180_000);
export const stageAnalysisModelVersion = CACHE_VERSION;

export const RULES = ['ナワバリ', 'エリア', 'ヤグラ', 'ホコ', 'アサリ'];

function splitAssetName(fileName) {
  const match = fileName.match(/^(.*)_(ナワバリ|エリア|ヤグラ|ホコ|アサリ)\.webp$/u);
  return match ? { stage: match[1], rule: match[2], fileName } : null;
}

export async function loadStageCatalog() {
  const entries = (await fs.readdir(STAGE_MAP_ROOT))
    .map(splitAssetName)
    .filter(Boolean);
  const stages = [...new Set(entries.map(entry => entry.stage))].sort((left, right) => left.localeCompare(right, 'ja'));
  return {
    stages,
    rules: RULES,
    assets: new Map(entries.map(entry => [`${entry.stage}\u0000${entry.rule}`, entry.fileName])),
  };
}

export function normalizeStageAnalysis(value, expectedIds, catalog) {
  if (!value || !Array.isArray(value.matches)) return [];
  const allowedIds = expectedIds instanceof Set ? expectedIds : new Set(expectedIds);
  const seen = new Set();
  return value.matches.flatMap(item => {
    const id = String(item?.id || '');
    const stage = String(item?.stage || '').trim();
    const rule = String(item?.rule || '').trim();
    const confidence = Number(item?.confidence);
    const stageAsset = catalog.assets.get(`${stage}\u0000${rule}`);
    if (!allowedIds.has(id) || seen.has(id) || !stageAsset || !Number.isFinite(confidence)) return [];
    seen.add(id);
    return [{
      id,
      stage,
      rule,
      stageAsset,
      confidence: Number(Math.max(0, Math.min(1, confidence)).toFixed(3)),
      evidence: String(item?.evidence || '').trim().slice(0, 240),
      source: 'result-header-codex-vision',
    }];
  });
}

async function cacheSignature(source, entries) {
  const stat = await fs.stat(source);
  return createHash('sha256').update(JSON.stringify({
    version: CACHE_VERSION,
    source: { size: stat.size, modified: stat.mtimeMs },
    entries: entries.map(({ id, time }) => ({ id, time: Number(time.toFixed(3)) })),
  })).digest('hex');
}

async function analyzeBatch(entries, catalog, batchIndex, frameDir) {
  const outputPath = path.join(frameDir, `result-${batchIndex}.json`);
  const prompt = `スプラトゥーン3のリザルト画像から、各試合のルール名とステージ名を読み取ってください。
画像左上または右側パネル上部の黒い見出しに「ルール」「ステージ」として表示されています。ロビーの次回候補一覧ではなく、その試合のリザルト見出しだけを根拠にしてください。

画像の対応:
${entries.map(entry => `- ${entry.id}: ${path.basename(entry.imagePath)}`).join('\n')}

ルールは次のいずれか（画面の「ガチ」は除く）:
${catalog.rules.join('、')}

ステージは次のいずれか:
${catalog.stages.join('、')}

各idを必ず1回返してください。見出しを直接読めた場合は confidence を0.9以上、画面が不鮮明または見出しがない場合は推測せず confidence を0.5以下にしてください。evidenceには読んだ表示位置を短く書いてください。`;
  const args = [
    'exec', '--sandbox', 'read-only', '--skip-git-repo-check',
    '--image', ...entries.map(entry => entry.imagePath),
    '--output-schema', SCHEMA_PATH,
    '--output-last-message', outputPath,
  ];
  if (CODEX_MODEL) args.push('--model', CODEX_MODEL);
  args.push('-');
  await runCodex(args, { input: prompt, timeoutMs: CODEX_TIMEOUT_MS });
  const raw = JSON.parse(await fs.readFile(outputPath, 'utf8'));
  return normalizeStageAnalysis(raw, new Set(entries.map(entry => entry.id)), catalog);
}

export async function classifyStageResultImages(entries, { workDir, cacheKey = null } = {}) {
  if (!entries.length || !ANALYSIS_ENABLED) return [];
  const catalog = await loadStageCatalog();
  const frameDir = path.join(workDir, 'stage-results');
  const cachePath = path.join(frameDir, 'analysis-cache.json');
  await fs.mkdir(frameDir, { recursive: true });
  if (cacheKey) {
    try {
      const cached = JSON.parse(await fs.readFile(cachePath, 'utf8'));
      const normalized = normalizeStageAnalysis(cached, new Set(entries.map(entry => entry.id)), catalog);
      if (cached.version === CACHE_VERSION && cached.cacheKey === cacheKey && normalized.length === entries.length) return normalized;
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
  }
  if (!(await codexAvailable())) return [];
  const results = [];
  for (let index = 0; index < entries.length; index += BATCH_SIZE) {
    results.push(...await analyzeBatch(entries.slice(index, index + BATCH_SIZE), catalog, Math.floor(index / BATCH_SIZE) + 1, frameDir));
  }
  if (cacheKey) await fs.writeFile(cachePath, `${JSON.stringify({ version: CACHE_VERSION, cacheKey, matches: results }, null, 2)}\n`);
  return results;
}

export async function analyzeRecordingStages({ source, segments, resultTimes = [], workDir }) {
  if (!ANALYSIS_ENABLED || !segments.length) return [];
  const frameDir = path.join(workDir, 'stage-results');
  await fs.mkdir(frameDir, { recursive: true });
  const entries = [];
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const time = Number.isFinite(resultTimes[index])
      ? resultTimes[index]
      : Number.isFinite(segment.resultBoundary?.detectedAt)
        ? segment.resultBoundary.detectedAt
        : Math.max(segment.activeEnd, segment.end - 1.25);
    const id = `match-${String(index + 1).padStart(2, '0')}`;
    const imagePath = path.join(frameDir, `${id}.jpg`);
    await extractJpeg(source, time, imagePath, 960);
    entries.push({ id, time, imagePath });
  }
  const signature = await cacheSignature(source, entries);
  return classifyStageResultImages(entries, { workDir, cacheKey: signature });
}
