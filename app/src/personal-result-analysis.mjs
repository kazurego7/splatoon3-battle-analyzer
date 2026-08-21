import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { APP_ROOT } from './paths.mjs';
import { extractJpeg } from './ffmpeg.mjs';
import { codexAvailable, runCodex } from './codex-death-analysis.mjs';
import { loadStageCatalog } from './stage-analysis.mjs';
import { weaponCatalogEntries } from './weapon-analysis.mjs';
import { mapWithConcurrency, positiveConcurrency } from './concurrency.mjs';

const SCHEMA_PATH = path.join(APP_ROOT, 'config', 'personal-result-analysis.schema.json');
const CACHE_VERSION = 1;
const BATCH_SIZE = 6;
const ANALYSIS_ENABLED = process.env.CODEX_PERSONAL_RESULT_ANALYSIS !== 'false';
const CODEX_MODEL = process.env.CODEX_PERSONAL_RESULT_MODEL || '';
const CODEX_TIMEOUT_MS = Math.max(10_000, Number(process.env.CODEX_PERSONAL_RESULT_TIMEOUT_MS) || 180_000);
const FRAME_CONCURRENCY = positiveConcurrency(process.env.VIDEO_ANALYSIS_CONCURRENCY, 2);
export const personalResultAnalysisModelVersion = CACHE_VERSION;

function normalize(value, expectedIds, stageCatalog, weaponNames) {
  if (!value || !Array.isArray(value.matches)) return [];
  const seen = new Set();
  return value.matches.flatMap(item => {
    const id = String(item?.id || '');
    const stage = String(item?.stage || '').trim();
    const rule = String(item?.rule || '').trim().replace(/^ガチ/u, '');
    const weapon = String(item?.weapon || '').trim();
    const kills = Number(item?.kills);
    const deaths = Number(item?.deaths);
    const specials = Number(item?.specials);
    const confidence = Number(item?.confidence);
    if (!expectedIds.has(id) || seen.has(id)
      || !stageCatalog.assets.has(`${stage}\u0000${rule}`) || !weaponNames.has(weapon)
      || ![kills, deaths, specials].every(Number.isInteger) || !Number.isFinite(confidence)) return [];
    seen.add(id);
    return [{
      id, stage, rule, weapon, kills, deaths, specials,
      confidence: Number(Math.max(0, Math.min(1, confidence)).toFixed(3)),
      evidence: String(item?.evidence || '').trim().slice(0, 240),
      source: 'personal-result-codex-vision',
    }];
  });
}

async function signature(source, entries) {
  const stat = await fs.stat(source);
  return createHash('sha256').update(JSON.stringify({
    version: CACHE_VERSION,
    source: { size: stat.size, modified: stat.mtimeMs },
    entries: entries.map(entry => ({ id: entry.id, time: Number(entry.time.toFixed(3)) })),
  })).digest('hex');
}

async function analyzeBatch(entries, stageCatalog, weapons, batchIndex, frameDir) {
  const outputPath = path.join(frameDir, `personal-result-${batchIndex}.json`);
  const prompt = `スプラトゥーン3の個人リザルト画像だけを読み取ってください。ほかの種類のリザルト画面は使用してはいけません。
右パネル上部からルールとステージ、プレイヤー名の右側に横並びで表示されるキル・デス・スペシャル回数、右パネル下部左端のブキカードからブキ名を読み取ります。キル・デス・スペシャルは各アイコン直後の「xNN」のNNです。推測せず、表示を直接読み取ってください。

画像の対応:
${entries.map(entry => `- ${entry.id}: ${path.basename(entry.imagePath)}`).join('\n')}

ルール候補: ${stageCatalog.rules.join('、')}
ステージ候補: ${stageCatalog.stages.join('、')}
ブキ候補: ${weapons.map(item => item.name).join('、')}

各idを必ず1回返してください。全項目を明瞭に直接読めた場合のみconfidenceを0.9以上にしてください。evidenceには各表示位置を短く書いてください。`;
  const args = [
    'exec', '--sandbox', 'read-only', '--skip-git-repo-check',
    '--image', ...entries.map(entry => entry.imagePath),
    '--output-schema', SCHEMA_PATH,
    '--output-last-message', outputPath,
  ];
  if (CODEX_MODEL) args.push('--model', CODEX_MODEL);
  args.push('-');
  await runCodex(args, { input: prompt, timeoutMs: CODEX_TIMEOUT_MS });
  return JSON.parse(await fs.readFile(outputPath, 'utf8'));
}

export async function analyzeRecordingPersonalResults({ source, segments, workDir }) {
  if (!ANALYSIS_ENABLED || !segments.length) return [];
  const frameDir = path.join(workDir, 'personal-results');
  await fs.mkdir(frameDir, { recursive: true });
  const entries = (await mapWithConcurrency(segments, FRAME_CONCURRENCY, async (segment, index) => {
    const time = segment.resultBoundary?.detectedAt;
    if (!Number.isFinite(time)) return null;
    const id = `match-${String(index + 1).padStart(2, '0')}`;
    const imagePath = path.join(frameDir, `${id}.jpg`);
    await extractJpeg(source, time, imagePath, 960);
    return { id, time, imagePath };
  })).filter(Boolean);
  if (!entries.length || !(await codexAvailable())) return [];
  const cacheKey = await signature(source, entries);
  const cachePath = path.join(frameDir, 'analysis-cache.json');
  const stageCatalog = await loadStageCatalog();
  const weapons = weaponCatalogEntries();
  const expectedIds = new Set(entries.map(entry => entry.id));
  const weaponNames = new Set(weapons.map(item => item.name));
  try {
    const cached = JSON.parse(await fs.readFile(cachePath, 'utf8'));
    const normalized = normalize(cached, expectedIds, stageCatalog, weaponNames);
    if (cached.version === CACHE_VERSION && cached.cacheKey === cacheKey && normalized.length === entries.length) return normalized;
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
  }
  const rawMatches = [];
  for (let index = 0; index < entries.length; index += BATCH_SIZE) {
    const raw = await analyzeBatch(entries.slice(index, index + BATCH_SIZE), stageCatalog, weapons, Math.floor(index / BATCH_SIZE) + 1, frameDir);
    rawMatches.push(...(raw.matches || []));
  }
  const results = normalize({ matches: rawMatches }, expectedIds, stageCatalog, weaponNames);
  await fs.writeFile(cachePath, `${JSON.stringify({ version: CACHE_VERSION, cacheKey, matches: results }, null, 2)}\n`);
  return results;
}
