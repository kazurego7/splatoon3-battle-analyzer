import fs from 'node:fs/promises';
import path from 'node:path';
import { probeMedia, sampleRgbWindow } from '../../src/ffmpeg.mjs';
import { LiveMatchStateMachine, liveResultScreenType, stablePersonalResultPair } from '../../src/live-analysis-state.mjs';
import { analyzePersonalResultFrame, detectResultScreen } from '../../src/result-analysis.mjs';
import { chooseResultBoundary } from '../../src/result-boundary.mjs';
import { mapWithConcurrency } from '../../src/concurrency.mjs';
import { STATE_FILE } from '../../src/paths.mjs';

const [sourceArgument, recordingId, matchArgument] = process.argv.slice(2);
if (!sourceArgument || !recordingId) {
  throw new Error('usage: node scripts/diagnostics/compare-live-result-detector.mjs <source> <recording-id>');
}
const source = path.resolve(sourceArgument);
const media = await probeMedia(source);
const state = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
const recording = state.recordings.find(item => item.id === recordingId);
if (!recording) throw new Error(`recording not found: ${recordingId}`);
const matches = (recording.matches || []).filter(match => match.status === 'ready');
let completed = 0;

const targets = matches.map((match, index) => ({ match, index }))
  .filter(({ index }) => !matchArgument || index + 1 === Number(matchArgument));
const rows = await mapWithConcurrency(targets, 2, async ({ match, index }) => {
  const interval = 0.25;
  const rawStart = Math.max(match.start, match.end - 90);
  const searchStart = Number((Math.floor(rawStart / interval) * interval).toFixed(3));
  const searchEnd = matches[index + 1]?.start ? matches[index + 1].start - 0.25 : media.duration;
  const observations = await sampleRgbWindow(source, searchStart, searchEnd, {
    interval,
    onFrame: (frame, _width, _height, time) => ({
      time,
      result: detectResultScreen(frame, time),
      personalResult: analyzePersonalResultFrame(frame, time),
    }),
  });
  const machine = new LiveMatchStateMachine();
  machine.active = {
    number: 1, start: match.start, activeEnd: null, end: null,
    status: 'analyzing', resultBoundary: null,
  };
  const observedResults = [];
  let personalRun = [];
  let resultAtPublication = null;
  machine.on('result-detected', () => {
    const groups = Object.entries(observedResults.reduce((counts, item) => {
      const key = `${item.killCount}:${item.deathCount}`;
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {})).sort((left, right) => right[1] - left[1]);
    resultAtPublication = groups[0]?.[0] || null;
  });
  for (const observation of observations) {
    if (observation.personalResult) {
      observedResults.push(observation.personalResult);
      const previous = personalRun.at(-1);
      if (previous && observation.time - previous.absoluteTime > 0.625) personalRun = [];
      personalRun.push(observation.personalResult);
      personalRun = personalRun.slice(-4);
    }
    const resultAlreadyConfirmed = Boolean(machine.active?.resultBoundary);
    machine.observeResult({
      time: observation.time,
      screenType: liveResultScreenType({
        personalResult: !resultAlreadyConfirmed && stablePersonalResultPair(personalRun) ? observation.personalResult : null,
        result: observation.result,
        resultAlreadyConfirmed,
      }),
    });
  }
  const live = machine.matches[0];
  const batch = chooseResultBoundary(observations.map(observation => ({
    time: observation.time,
    screenType: observation.result?.screenType || null,
  })), { fallbackEnd: match.end, searchEnd, interval });
  completed += 1;
  process.stderr.write(`\r${completed}/${targets.length}`);
  const validResults = observations.filter(item => item.personalResult).map(item => ({
    time: item.time,
    kills: item.personalResult.killCount,
    deaths: item.personalResult.deathCount,
  }));
  const resultCounts = Object.entries(validResults.reduce((counts, item) => {
    const key = `${item.kills}:${item.deaths}`;
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {})).sort((left, right) => right[1] - left[1]);
  return {
    match: index + 1,
    liveEnd: live?.end ?? null,
    batchEnd: batch.end,
    difference: live ? Number((live.end - batch.end).toFixed(3)) : null,
    resultAtPublication,
    firstResults: validResults.slice(0, 5),
    resultCounts,
  };
});
process.stderr.write('\n');
console.log(JSON.stringify({
  matches: rows.length,
  exact: rows.every(row => row.difference === 0),
  publicationStable: rows.every(row => row.resultAtPublication === row.resultCounts[0]?.[0]),
  rows,
}, null, 2));
