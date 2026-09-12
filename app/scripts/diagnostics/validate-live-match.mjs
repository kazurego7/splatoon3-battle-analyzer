import fs from 'node:fs/promises';
import path from 'node:path';
import { LiveAnalysisCollector } from '../../src/live-analysis-state.mjs';
import { selectMatchFragments } from '../../src/fragment-manifest.mjs';
import { finalizeLiveMatchAnalysis } from '../../src/live-match-finalizer.mjs';
import { LiveMediaSession } from '../../src/live-media-session.mjs';

const [source, referenceFile, outputDir] = process.argv.slice(2);
if (!source || !referenceFile || !outputDir) {
  throw new Error('usage: node scripts/diagnostics/validate-live-match.mjs <source> <reference-analysis> <output-dir>');
}

const reference = JSON.parse(await fs.readFile(referenceFile, 'utf8'));
const collector = new LiveAnalysisCollector();
const session = new LiveMediaSession({ source, outputDir, segmentSeconds: 2 });
const finalized = [];

for (const [event, accept] of [
  ['coarse', (frame, time) => collector.acceptCoarse(frame, time)],
  ['battle-hud', (frame, time) => collector.acceptBattleHud(frame, time)],
  ['respawn-hud', (frame, time) => collector.acceptRespawn(frame, time)],
  ['full', (frame, time) => collector.acceptFull(frame, time)],
  ['perception', (frame, time) => collector.acceptPerception(frame, time)],
  ['score-count', (frame, time) => collector.acceptScoreCount(frame, time)],
  ['objective-count', (frame, time) => collector.acceptObjectiveCount(frame, time)],
]) session.on(event, accept);
collector.on('match-finalized', match => finalized.push(match));

const segments = await session.start();
const match = finalized[0] || collector.machine.matches[0];
if (!match) throw new Error('live match was not finalized');
const samples = collector.samples.get(match.number);
const manifest = selectMatchFragments(segments, { start: match.start, end: match.end });
const live = finalizeLiveMatchAnalysis({
  recording: {
    id: 'live-validation',
    fileName: path.basename(source),
    media: reference.media,
  },
  media: reference.media,
  match: { ...match, id: 'live-validation-match-01' },
  samples,
});
const fragmentBytes = (await Promise.all(manifest.fragments.map(async fragment => (
  await fs.stat(path.join(outputDir, fragment.url))
).size))).reduce((total, size) => total + size, 0);

const summary = analysis => ({
  boundary: [analysis.source.start, analysis.source.end],
  playerStats: analysis.playerStats && {
    kills: analysis.playerStats.kills,
    deaths: analysis.playerStats.deaths,
  },
  outcome: analysis.outcome?.outcome ?? analysis.outcome ?? null,
  deaths: analysis.gameFlow?.deaths?.self?.map(item => item[0]) || [],
  playerCounts: analysis.gameFlow?.playerCounts || [],
  gameCounts: analysis.gameFlow?.gameCounts || [],
});

console.log(JSON.stringify({
  reference: summary(reference),
  live: summary(live),
  manifest: {
    fragments: manifest.fragments.length,
    playbackStart: manifest.playbackStart,
    playbackEnd: manifest.playbackEnd,
    duration: manifest.duration,
    bytes: fragmentBytes,
  },
}, null, 2));
