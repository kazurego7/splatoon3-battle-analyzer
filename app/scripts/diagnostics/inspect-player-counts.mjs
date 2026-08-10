import path from 'node:path';
import { probeMedia, sampleBattleHud } from '../../src/ffmpeg.mjs';
import { detectPlayerCounts } from '../../src/battle-analysis.mjs';

const source = path.resolve(process.argv[2]);
if (!process.argv[2]) throw new Error('動画ファイルを指定してください');
const media = await probeMedia(source);
const gameplayEnd = Number(process.argv[3] || media.duration);
const samples = await sampleBattleHud(source, media.duration);
const timeline = detectPlayerCounts(samples, { gameplayEnd });
const inspectTimes = (process.argv[4] || '').split(',').map(Number).filter(Number.isFinite);
const inspected = inspectTimes.map(time => ({
  time,
  sample: samples.reduce((closest, sample) => Math.abs(sample.time - time) < Math.abs(closest.time - time) ? sample : closest),
}));
const changes = timeline.filter((state, index) => {
  const previous = timeline[index - 1];
  return !previous || state.teamAlive !== previous.teamAlive || state.enemyAlive !== previous.enemyAlive || state.source !== previous.source;
});
console.log(JSON.stringify({
  source,
  duration: media.duration,
  gameplayEnd,
  coverage: timeline.length / Math.max(1, gameplayEnd - 10),
  changes,
  inspected,
}, null, 2));
