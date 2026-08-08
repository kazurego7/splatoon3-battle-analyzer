import path from 'node:path';
import { probeMedia, sampleSelfHud } from '../src/ffmpeg.mjs';
import { detectSelfDeaths } from '../src/battle-analysis.mjs';

const source = path.resolve(process.argv[2]);
if (!process.argv[2]) throw new Error('動画ファイルを指定してください');
const media = await probeMedia(source);
const gameplayEnd = Number(process.argv[3] || media.duration);
const samples = await sampleSelfHud(source, media.duration);
const deaths = detectSelfDeaths(samples, { duration: media.duration, gameplayEnd });
console.log(JSON.stringify({
  source,
  duration: media.duration,
  gameplayEnd,
  deaths: deaths.map(death => ({
    time: death.time,
    end: death.end,
    duration: death.duration,
    confidence: death.confidence,
  })),
}, null, 2));
