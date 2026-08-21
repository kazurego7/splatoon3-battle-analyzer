import fs from 'node:fs/promises';
import path from 'node:path';
import { detectPlayerCounts } from '../../src/battle-analysis.mjs';
import { sampleRgbWindow } from '../../src/ffmpeg.mjs';
import { detectGameCounts } from '../../src/game-count-vision.mjs';
import {
  analyzeMapCandidate,
  buildEnemySightPredictions,
  buildEnemyThreatZones,
  buildEntityPredictions,
  buildPlayerRoute,
  buildShortPredictions,
  detectAllyTracks,
  detectSpatialObservations,
  stabilizeMapVisibility,
} from '../../src/map-analysis.mjs';
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
  const mapCacheFile = path.join(workDir, `map-candidates-match-${number}.json`);
  const battleCacheFile = path.join(workDir, `battle-hud-match-${number}.json`);
  const gameCountCacheFile = path.join(workDir, `game-count-match-${number}.json`);
  const analysisFile = path.join(ANALYSIS_ROOT, recording.id, `match-${number}.json`);
  const previousMapCache = JSON.parse(await fs.readFile(mapCacheFile, 'utf8'));
  const segment = segments[index];
  const gameplayEnd = Math.max(0, segment.activeEnd - segment.start);
  const reusable = previousMapCache.version === 9
    && previousMapCache.samples?.every(sample => Number.isFinite(sample.mapUi?.startPointButton?.arrowComponents));
  console.log(`試合 ${number}/${String(recording.matches.length).padStart(2, '0')} のマップ表示を${reusable ? '再判定' : '再読取'}中`);
  const mapCandidates = reusable
    ? stabilizeMapVisibility(previousMapCache.samples)
    : stabilizeMapVisibility(await sampleRgbWindow(video, 0, gameplayEnd, {
      interval: 0.5,
      onFrame: (frame, width, height, time) => analyzeMapCandidate(frame, width, height, time),
    }));
  await writeJsonAtomic(mapCacheFile, { ...previousMapCache, version: 9, samples: mapCandidates });

  const hiddenTimes = mapCandidates.filter(sample => sample.mapUi?.visible).map(sample => sample.time);
  const battleCache = JSON.parse(await fs.readFile(battleCacheFile, 'utf8'));
  const gameCountCache = JSON.parse(await fs.readFile(gameCountCacheFile, 'utf8'));
  const analysis = JSON.parse(await fs.readFile(analysisFile, 'utf8'));
  const playerCounts = detectPlayerCounts(battleCache.samples || [], { gameplayEnd, hiddenTimes });
  const gameCounts = detectGameCounts(gameCountCache.samples || [], { gameplayEnd, hiddenTimes });
  const observations = detectSpatialObservations(mapCandidates);
  const playerRoute = buildPlayerRoute(observations);
  const allyTracks = detectAllyTracks(mapCandidates);
  const detections = analysis.detections || [];
  const deaths = analysis.events || [];
  const predictions = [
    ...buildShortPredictions(observations),
    ...buildEntityPredictions(allyTracks),
    ...buildEnemySightPredictions(detections, playerRoute),
  ].sort((left, right) => left.observedAt - right.observedAt);
  analysis.gameFlow = { ...(analysis.gameFlow || {}), playerCounts, gameCounts };
  analysis.playerRoute = playerRoute;
  analysis.spatial = {
    ...(analysis.spatial || {}),
    observations,
    entityTracks: allyTracks,
    predictions,
    threatZones: buildEnemyThreatZones(deaths, observations),
  };
  analysis.capabilities = {
    ...(analysis.capabilities || {}),
    mapDetection: 'automatic-start-point-close-button-map-structure-temporal-fusion',
    playerRoute: playerRoute.length ? 'automatic-observed-self-marker-and-inferred-map-route' : 'unavailable-no-grounded-self-marker',
    mapAllies: allyTracks.length ? 'automatic-observed-map-markers-and-facing-prediction' : 'unavailable-no-ally-map-markers',
  };
  analysis.mapDetectionGeneratedAt = new Date().toISOString();
  await writeJsonAtomic(analysisFile, analysis);
  const filled = mapCandidates.filter(sample => sample.mapUi?.visibleSource?.startsWith('temporal-')).length;
  const direct = hiddenTimes.length - filled;
  console.log(`試合 ${number}: マップ ${hiddenTimes.length}フレーム（直接 ${direct} / 補完 ${filled}）`);
}

console.log(`${recording.fileName} のマップ表示判定を更新しました`);
