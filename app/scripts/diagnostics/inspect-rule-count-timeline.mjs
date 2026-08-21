import fs from 'node:fs/promises';
import path from 'node:path';
import { sampleGameCountFrames } from '../../src/ffmpeg.mjs';
import { analyzeGameCountFrame, detectGameCounts, gameCountFrameRegionForRule, gameCountModelVersion } from '../../src/game-count-vision.mjs';

const source = path.resolve(process.argv[2] || '');
const rule = process.argv[3] || null;
const duration = Number(process.argv[4] || 0);
const gameplayEnd = Number(process.argv[5] || duration);
const cachePath = process.argv[6] ? path.resolve(process.argv[6]) : null;
if (!source || !duration) throw new Error('動画パス、ルール、動画秒数を指定してください');

let samples;
if (cachePath) {
  try {
    const cached = JSON.parse(await fs.readFile(cachePath, 'utf8'));
    if (cached.modelVersion === gameCountModelVersion && cached.rule === rule) samples = cached.samples;
  } catch {}
}
if (!samples) {
  samples = await sampleGameCountFrames(source, duration, {
    interval: 0.5,
    crop: gameCountFrameRegionForRule(rule),
    onFrame: (frame, width, _height, time) => analyzeGameCountFrame(frame, width, time, { rule }),
  });
  if (cachePath) {
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.writeFile(cachePath, `${JSON.stringify({ modelVersion: gameCountModelVersion, rule, samples })}\n`);
  }
}
const timeline = detectGameCounts(samples, { gameplayEnd, rule });
const changes = timeline.filter((point, index) => !index
  || point.teamCount !== timeline[index - 1].teamCount
  || point.enemyCount !== timeline[index - 1].enemyCount
  || point.teamPenalty !== timeline[index - 1].teamPenalty
  || point.enemyPenalty !== timeline[index - 1].enemyPenalty);
const directlyObserved = timeline.filter(point => point.teamSource === 'observed' || point.enemySource === 'observed');

console.log(JSON.stringify({
  source,
  rule,
  samples: samples.length,
  points: timeline.length,
  directlyObserved: directlyObserved.length,
  final: timeline.at(-1) || null,
  changes,
}, null, 2));
