import fs from 'node:fs/promises';
import path from 'node:path';
import { detectPlayerCounts } from '../../src/battle-analysis.mjs';
import { sampleBattleHud } from '../../src/ffmpeg.mjs';
import { ANALYSIS_ROOT, APP_DATA_ROOT, MATCH_ROOT, WORK_ROOT } from '../../src/paths.mjs';

async function writeJsonAtomic(file, value) {
  const temporary = `${file}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(temporary, file);
}

const query = process.argv.slice(2).join(' ').trim();
if (!query) throw new Error('録画IDまたは録画ファイル名を指定してください');

const state = JSON.parse(await fs.readFile(path.join(APP_DATA_ROOT, 'state.json'), 'utf8'));
const recording = (state.recordings || []).find(item => item.id === query || item.fileName === query);
if (!recording) throw new Error(`録画が見つかりません: ${query}`);

const workDir = path.join(WORK_ROOT, recording.id);
const manifest = JSON.parse(await fs.readFile(path.join(workDir, 'manifest.json'), 'utf8'));
const segments = manifest.segments || [];
if (segments.length !== recording.matches.length) throw new Error('試合情報と区間情報の件数が一致しません');

for (let index = 0; index < recording.matches.length; index += 1) {
  const match = recording.matches[index];
  const number = String(match.number).padStart(2, '0');
  const video = path.join(MATCH_ROOT, recording.id, match.fileName);
  const cacheFile = path.join(workDir, `battle-hud-match-${number}.json`);
  const mapCacheFile = path.join(workDir, `map-candidates-match-${number}.json`);
  const analysisFile = path.join(ANALYSIS_ROOT, recording.id, `match-${number}.json`);
  const previousCache = JSON.parse(await fs.readFile(cacheFile, 'utf8'));
  let samples;
  if (previousCache.version === 3 && Number.isFinite(previousCache.samples?.[0]?.team?.[0]?.crossDown)) {
    samples = previousCache.samples;
    console.log(`試合 ${number}/${String(recording.matches.length).padStart(2, '0')} は再読取済み`);
  } else {
    console.log(`試合 ${number}/${String(recording.matches.length).padStart(2, '0')} のHUDを再読取中`);
    let reportedQuarter = 0;
    samples = await sampleBattleHud(video, match.duration, {
      interval: 0.25,
      onProgress: ratio => {
        const quarter = Math.floor(ratio * 4);
        if (quarter > reportedQuarter) {
          reportedQuarter = quarter;
          process.stdout.write('.');
        }
      },
    });
    process.stdout.write('\n');
    await writeJsonAtomic(cacheFile, { ...previousCache, version: 3, samples });
  }

  const segment = segments[index];
  const gameplayEnd = Math.max(0, segment.activeEnd - segment.start);
  const mapCache = JSON.parse(await fs.readFile(mapCacheFile, 'utf8'));
  const hiddenTimes = (mapCache.samples || []).filter(sample => sample.mapUi?.visible).map(sample => sample.time);
  const playerCounts = detectPlayerCounts(samples, { gameplayEnd, hiddenTimes });
  const analysis = JSON.parse(await fs.readFile(analysisFile, 'utf8'));
  analysis.gameFlow = { ...(analysis.gameFlow || {}), playerCounts };
  analysis.capabilities = { ...(analysis.capabilities || {}), playerCounts: 'automatic-centered-hud-cross-shape' };
  analysis.playerCountsGeneratedAt = new Date().toISOString();
  await writeJsonAtomic(analysisFile, analysis);
  console.log(`試合 ${number}: ${playerCounts.length}秒分を更新`);
}

console.log(`${recording.fileName} の生存人数を更新しました`);
