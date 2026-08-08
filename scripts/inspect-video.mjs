import fs from 'node:fs/promises';
import path from 'node:path';
import { probeMedia, sampleVideo } from '../src/ffmpeg.mjs';
import { classifySamples, detectMatchSegments } from '../src/segmentation.mjs';
import { PROJECT_ROOT, WORK_ROOT } from '../src/paths.mjs';

const input = process.argv[2] ? path.resolve(process.cwd(), process.argv[2]) : null;
if (!input) throw new Error('Usage: npm run inspect -- <video>');
const media = await probeMedia(input);
const samples = await sampleVideo(input, media.duration, {
  interval: 2,
  onProgress: ratio => {
    if (Math.round(ratio * 100) % 10 === 0) process.stderr.write(`\r${Math.round(ratio * 100)}%`);
  },
});
const classified = classifySamples(samples, 2);
const segments = detectMatchSegments(classified, media.duration, 2);
const recordingName = path.basename(input, path.extname(input)).replace(/[^\p{Letter}\p{Number}]+/gu, '-');
const output = path.join(WORK_ROOT, recordingName, 'inspection.json');
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, `${JSON.stringify({ input: path.relative(PROJECT_ROOT, input), media, segments, samples: classified }, null, 2)}\n`);
process.stderr.write('\r100%\n');
console.log(JSON.stringify({ media, segments, output }, null, 2));
