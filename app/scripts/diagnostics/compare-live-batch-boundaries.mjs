import fs from 'node:fs/promises';
import path from 'node:path';
import { probeMedia, sampleVideo } from '../../src/ffmpeg.mjs';
import { classifySamples, detectMatchSegments } from '../../src/segmentation.mjs';
import { refineIntroBoundaries } from '../../src/intro-boundary.mjs';
import { refineResultBoundaries } from '../../src/result-boundary.mjs';
import { STATE_FILE } from '../../src/paths.mjs';

const [sourceArgument, recordingId, mode] = process.argv.slice(2);
if (!sourceArgument || !recordingId) {
  throw new Error('usage: node scripts/diagnostics/compare-live-batch-boundaries.mjs <source> <recording-id>');
}
const source = path.resolve(sourceArgument);
const media = await probeMedia(source);
const state = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
const recording = state.recordings.find(item => item.id === recordingId);
if (!recording) throw new Error(`recording not found: ${recordingId}`);
const live = (recording.matches || []).filter(match => match.status === 'ready');
let detected;
if (mode === '--refine-only') {
  detected = live.map((match, index) => ({
    start: match.start,
    activeStart: match.start,
    activeEnd: Math.max(match.start, match.end - 20),
    end: live[index + 1]?.start ? live[index + 1].start - 0.25 : media.duration,
  }));
} else {
  const samples = await sampleVideo(source, media.duration, {
    interval: 2,
    onProgress: ratio => process.stderr.write(`\rcoarse ${Math.round(ratio * 100)}%`),
  });
  process.stderr.write('\n');
  const classified = classifySamples(samples, 2);
  detected = detectMatchSegments(classified, media.duration, 2);
}
const intros = await refineIntroBoundaries(source, detected, media.duration);
const batch = await refineResultBoundaries(source, intros, media.duration, {
  onProgress: ratio => process.stderr.write(`\rresults ${Math.round(ratio * 100)}%`),
});
process.stderr.write('\n');

const rows = Array.from({ length: Math.max(live.length, batch.length) }, (_, index) => ({
  match: index + 1,
  liveStart: live[index]?.start ?? null,
  batchStart: batch[index]?.start ?? null,
  startDifference: live[index] && batch[index] ? Number((live[index].start - batch[index].start).toFixed(3)) : null,
  liveEnd: live[index]?.end ?? null,
  batchEnd: batch[index]?.end ?? null,
  endDifference: live[index] && batch[index] ? Number((live[index].end - batch[index].end).toFixed(3)) : null,
}));
console.log(JSON.stringify({
  duration: media.duration,
  comparisonMode: mode === '--refine-only' ? 'same-candidates-refined-at-batch-settings' : 'full-batch-detection',
  liveMatches: live.length,
  batchMatches: batch.length,
  exact: live.length === batch.length && rows.every(row => row.startDifference === 0 && row.endDifference === 0),
  rows,
}, null, 2));
