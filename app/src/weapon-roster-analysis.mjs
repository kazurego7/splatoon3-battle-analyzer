import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { detectGameplayStart, openingRosterTimes } from './battle-analysis.mjs';
import { codexAvailable, runCodex } from './codex-death-analysis.mjs';
import { mapWithConcurrency, positiveConcurrency } from './concurrency.mjs';
import { extractJpegCrop, sampleBattleHud } from './ffmpeg.mjs';
import { APP_ROOT } from './paths.mjs';
import { weaponCatalogEntries, weaponCatalogMetadata } from './weapon-analysis.mjs';
import { weaponReferenceSheetPaths, writeWeaponHudSlotSheet } from './weapon-reference-sheets.mjs';

const SCHEMA_PATH = path.join(APP_ROOT, 'config', 'weapon-roster-analysis.schema.json');
const CACHE_VERSION = 9;
const BATCH_SIZE = 2;
const OPENING_SECONDS = 35;
const SLOT_CONFIDENCE = 0.92;
const ANALYSIS_ENABLED = process.env.CODEX_WEAPON_ROSTER_ANALYSIS !== 'false';
const CODEX_MODEL = process.env.CODEX_WEAPON_ROSTER_MODEL || '';
const CODEX_TIMEOUT_MS = Math.max(10_000, Number(process.env.CODEX_WEAPON_ROSTER_TIMEOUT_MS) || 180_000);
const FRAME_CONCURRENCY = positiveConcurrency(process.env.VIDEO_ANALYSIS_CONCURRENCY, 2);
export const weaponRosterAnalysisModelVersion = CACHE_VERSION;

function normalizedSlot(slot, weaponNames, references) {
  const firstReferenceId = Number(slot?.firstReferenceId);
  const secondReferenceId = Number(slot?.secondReferenceId);
  const referenceId = Number(slot?.referenceId);
  const mapped = references.get(referenceId);
  const weapon = String(mapped?.name || slot?.weapon || '').trim();
  const confidence = Number(slot?.confidence);
  if (!weaponNames.has(weapon) || !Number.isFinite(confidence)) return null;
  const hasFrameReferences = Number.isInteger(firstReferenceId) || Number.isInteger(secondReferenceId);
  const hasFrameTypes = Boolean(slot?.firstType || slot?.secondType);
  const typeAgreed = hasFrameTypes
    ? slot.firstType === slot.type && slot.secondType === slot.type && mapped?.type === slot.type
    : !slot?.type || mapped?.type === slot.type;
  const agreed = !hasFrameReferences || (
    firstReferenceId === referenceId
    && secondReferenceId === referenceId
    && references.get(firstReferenceId)?.name === weapon
    && typeAgreed
  );
  return {
    weapon,
    confidence: Number(Math.max(0, Math.min(1, confidence)).toFixed(3)),
    ...(hasFrameReferences ? {
      type: mapped?.type || slot.type || null,
      referenceId,
      firstReferenceId,
      secondReferenceId,
      agreed,
    } : {}),
  };
}

export function normalizeWeaponRosterAnalysis(value, entriesById, weapons) {
  if (!value || !Array.isArray(value.matches)) return [];
  const weaponNames = weapons instanceof Set ? weapons : new Set(weapons.map(item => item.name));
  const references = new Map((weapons instanceof Set ? [] : weapons).map((item, index) => [index + 1, item]));
  const seen = new Set();
  return value.matches.flatMap(item => {
    const id = String(item?.id || '');
    const entry = entriesById.get(id);
    const sourceTeam = item.team || item.teamSlots;
    const sourceEnemy = item.enemy || item.enemySlots;
    if (!entry || seen.has(id) || sourceTeam?.length !== 4 || sourceEnemy?.length !== 4) return [];
    const team = sourceTeam.map(slot => normalizedSlot(slot, weaponNames, references));
    const enemy = sourceEnemy.map(slot => normalizedSlot(slot, weaponNames, references));
    if ([...team, ...enemy].some(slot => !slot)) return [];
    const expectedSelfWeapon = entry.expectedSelfWeapon;
    const selfSlot = expectedSelfWeapon
      ? team.findIndex(slot => slot.weapon === expectedSelfWeapon && slot.confidence >= SLOT_CONFIDENCE && slot.agreed !== false)
      : -1;
    if (expectedSelfWeapon && selfSlot < 0) return [];
    const acceptedTeam = team.map((slot, index) => ({ ...slot, accepted: (slot.confidence >= SLOT_CONFIDENCE && slot.agreed !== false) || index === selfSlot }));
    const acceptedEnemy = enemy.map(slot => ({ ...slot, accepted: slot.confidence >= SLOT_CONFIDENCE && slot.agreed !== false }));
    const allies = acceptedTeam
      .filter((slot, index) => index !== selfSlot && slot.accepted)
      .map(slot => slot.weapon);
    const enemies = acceptedEnemy.filter(slot => slot.accepted).map(slot => slot.weapon);
    const complete = acceptedTeam.every(slot => slot.accepted) && acceptedEnemy.every(slot => slot.accepted);
    seen.add(id);
    return [{
      id,
      modelVersion: CACHE_VERSION,
      catalogVersion: weaponCatalogMetadata.version,
      source: 'opening-battle-hud-codex-vision-with-wikiwiki-reference-sheets',
      openingTimes: entry.times,
      expectedSelfWeapon,
      selfSlot: selfSlot >= 0 ? selfSlot : null,
      teamSlots: acceptedTeam,
      enemySlots: acceptedEnemy,
      teamWeapons: acceptedTeam.filter(slot => slot.accepted).map(slot => slot.weapon),
      allyWeapons: allies,
      enemyWeapons: enemies,
      confidence: Number(Math.min(...[...team, ...enemy].map(slot => slot.confidence)).toFixed(3)),
      complete,
      evidence: String(item.evidence || '').trim().slice(0, 300),
    }];
  });
}

async function prepareEntry({ match, index, clipRoot, frameDir, expectedSelfWeapon, timeOffset }) {
  const id = `match-${String(match.number || index + 1).padStart(2, '0')}`;
  const clipPath = path.join(clipRoot, match.fileName);
  const openingDuration = Math.min(match.duration || OPENING_SECONDS, OPENING_SECONDS);
  const hud = await sampleBattleHud(clipPath, openingDuration, { maxDuration: openingDuration });
  const gameplayStart = detectGameplayStart(hud, { earliest: 3, gameplayEnd: openingDuration, requireRoster: true });
  const times = openingRosterTimes(hud, {
    gameplayStart,
    gameplayEnd: openingDuration,
    allowTimerFallback: true,
    candidateOffset: timeOffset,
  });
  if (times.length < 2) return null;
  const imagePaths = [];
  const slotImagePaths = [];
  for (let frameIndex = 0; frameIndex < times.length; frameIndex += 1) {
    const imagePath = path.join(frameDir, `${id}-${frameIndex + 1}.jpg`);
    await extractJpegCrop(clipPath, times[frameIndex], imagePath, {
      x: 460, y: 0, width: 990, height: 130, outputWidth: 990, outputHeight: 130,
    });
    imagePaths.push(imagePath);
    const slotImagePath = path.join(frameDir, `${id}-${frameIndex + 1}-slots.jpg`);
    await writeWeaponHudSlotSheet(imagePath, slotImagePath);
    slotImagePaths.push(slotImagePath);
  }
  return { id, clipPath, times, imagePaths, slotImagePaths, expectedSelfWeapon };
}

async function cacheSignature(entries) {
  const clips = [];
  for (const entry of entries) {
    const stat = await fs.stat(entry.clipPath);
    clips.push({ id: entry.id, size: stat.size, modified: stat.mtimeMs, times: entry.times });
  }
  return createHash('sha256').update(JSON.stringify({
    version: CACHE_VERSION,
    catalogVersion: weaponCatalogMetadata.version,
    clips,
  })).digest('hex');
}

async function analyzeBatch(entries, weapons, referencePaths, batchIndex, frameDir) {
  const outputPath = path.join(frameDir, `weapon-rosters-${batchIndex}.json`);
  const entryGuide = entries.map(entry => {
    return `- ${entry.id}: 1枚目=${path.basename(entry.slotImagePaths[0])}、2枚目=${path.basename(entry.slotImagePaths[1])}、自分のブキ=${entry.expectedSelfWeapon || '不明'}`;
  }).join('\n');
  const prompt = `スプラトゥーン3のバトル中、画面上部に常時表示される8個のブキアイコンだけを読み取ってください。
添付はGO後から最初のデス表示より前に抽出した同一試合2フレームを、A1〜A4（味方・左から右）とE1〜E4（相手・左から右）へ個別に拡大した画像です。同じブキが複数いても省略してはいけません。背景のインク形状や枠の色は判定に使わず、枠中央のブキ本体だけを参照アイコンと比較してください。×印が見える画像があれば、その画像は使わずもう一方だけで判断し、confidenceを下げてください。

最初の${referencePaths.length}枚は ${weaponCatalogMetadata.source} から取得した全ブキの番号付き参照シートです。各枠について、最初にブキ本体が1丁か、左右に分かれた2丁1組かを数えてください。独立した銃身・グリップ・銃口が2組見えるものは必ずマニューバーです。2丁を上下や斜めに重なった1丁と解釈してシューターやブラスターにしてはいけません。そのうえでブキ本体の構造から11種別（シューター、ローラー、チャージャー、ブラスター、スロッシャー、スピナー、フデ、マニューバー、シェルター、ストリンガー、ワイパー）のどれかを、1枚目と2枚目で別々に判定してください。その後、その種別に属する参照番号だけを比較してください。種別外の番号を選んではいけません。HUDの色や既知のブキ知識だけで推測せず、各枠の形・向き・シール・色の細部を参照シートと直接比較してください。firstType/firstReferenceIdは1枚目、secondType/secondReferenceIdは2枚目を別々に見て選び、両者が同じときだけtype/referenceIdを同じ値にしてconfidenceを0.92以上にできます。2枚で違う候補なら最有力をtype/referenceIdにしつつconfidenceを0.91以下にしてください。自分のブキは個人リザルト由来の整合性チェックであり、味方4枠のどこかに必ず見えるはずです。他の枠を自分のブキから推測してはいけません。

画像の対応:
${entryGuide}

参照番号とブキ名:
${weapons.map((item, index) => `${String(index + 1).padStart(3, '0')}=${item.type}/${item.name}`).join('、')}

各idを必ず1回返し、teamとenemyはそれぞれ左から4要素にしてください。evidenceには2フレームと参照シートを照合した根拠を短く書いてください。`;
  const args = [
    'exec', '--sandbox', 'read-only', '--skip-git-repo-check',
    '--image', ...referencePaths, ...entries.flatMap(entry => entry.slotImagePaths),
    '--output-schema', SCHEMA_PATH,
    '--output-last-message', outputPath,
  ];
  if (CODEX_MODEL) args.push('--model', CODEX_MODEL);
  args.push('-');
  await runCodex(args, { input: prompt, timeoutMs: CODEX_TIMEOUT_MS });
  return JSON.parse(await fs.readFile(outputPath, 'utf8'));
}

export async function analyzeRecordingWeaponRosters({ matches, clipRoot, workDir, expectedWeapons = new Map(), force = false, timeOffset = 0, services = {} }) {
  if (!ANALYSIS_ENABLED || !matches.length || !weaponCatalogMetadata.hudAvailable) return new Map();
  const frameDir = path.join(workDir, 'weapon-rosters');
  await fs.mkdir(frameDir, { recursive: true });
  const entries = (await mapWithConcurrency(matches, FRAME_CONCURRENCY, (match, index) => prepareEntry({
    match,
    index,
    clipRoot,
    frameDir,
    expectedSelfWeapon: expectedWeapons.get(`match-${String(match.number || index + 1).padStart(2, '0')}`) || null,
    timeOffset,
  }))).filter(Boolean);
  if (!entries.length) return new Map();
  const entriesById = new Map(entries.map(entry => [entry.id, entry]));
  const weapons = weaponCatalogEntries();
  const referencePaths = weaponReferenceSheetPaths(weapons.length);
  try {
    await Promise.all(referencePaths.map(file => fs.access(file)));
  } catch {
    throw new Error('ブキ参照シートがありません。先に npm run sync:weapons を実行してください');
  }
  const cacheKey = await cacheSignature(entries);
  const cachePath = path.join(frameDir, 'analysis-cache.json');
  try {
    const cached = JSON.parse(await fs.readFile(cachePath, 'utf8'));
    const normalized = normalizeWeaponRosterAnalysis(cached, entriesById, weapons);
    if (!force && cached.version === CACHE_VERSION && cached.cacheKey === cacheKey && normalized.length === entries.length) {
      return new Map(normalized.map(result => [result.id, result]));
    }
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
  }
  const checkCodexAvailable = services.codexAvailable || codexAvailable;
  if (!(await checkCodexAvailable())) return new Map();
  const analyze = services.analyzeBatch || analyzeBatch;
  const rawMatches = [];
  for (let index = 0; index < entries.length; index += BATCH_SIZE) {
    const raw = await analyze(entries.slice(index, index + BATCH_SIZE), weapons, referencePaths, Math.floor(index / BATCH_SIZE) + 1, frameDir);
    rawMatches.push(...(raw.matches || []));
  }
  const results = normalizeWeaponRosterAnalysis({ matches: rawMatches }, entriesById, weapons);
  await fs.writeFile(cachePath, `${JSON.stringify({ version: CACHE_VERSION, cacheKey, matches: results }, null, 2)}\n`, 'utf8');
  return new Map(results.map(result => [result.id, result]));
}
