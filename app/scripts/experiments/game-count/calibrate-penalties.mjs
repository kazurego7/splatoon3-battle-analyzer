import fs from 'node:fs/promises';
import path from 'node:path';
import { extractRgbFrame } from '../../../src/ffmpeg.mjs';
import { countRois, extractDigitGlyphs } from '../../../src/game-count-vision.mjs';

const configPath = path.resolve(process.argv[2] || 'config/game-penalty-calibration-observations.json');
const outputPath = path.resolve(process.argv[3] || 'src/game-penalty-calibration-model.json');
const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
const matchesRoot = path.resolve(path.dirname(configPath), config.matchesRoot);
const thresholds = [95, 105, 118, 130, 145, 160, 175, 190, 'adaptive', 'white'];
const samples = [];
const known = new Set();
const acceptedByDigit = new Array(10).fill(0);
let rejected = 0;

function packedBits(mask) {
  const packed = Buffer.alloc(Math.ceil(mask.length / 8));
  mask.forEach((value, index) => { if (value) packed[Math.floor(index / 8)] |= 1 << (index % 8); });
  return packed.toString('base64');
}

function collect(glyphs, value) {
  if (value == null) return;
  const digits = String(value).split('').map(Number);
  if (glyphs.length !== digits.length) {
    rejected += 1;
    return;
  }
  glyphs.forEach((glyph, index) => {
    const sample = {
      digit: digits[index],
      width: glyph.width,
      height: glyph.height,
      pixels: glyph.pixels,
      bits: packedBits(glyph.mask),
    };
    const key = `${sample.digit}:${sample.bits}`;
    if (known.has(key)) return;
    known.add(key);
    samples.push(sample);
    acceptedByDigit[sample.digit] += 1;
  });
}

function cropCountHud(frame) {
  const width = 380;
  const height = 180;
  const cropped = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    frame.copy(cropped, y * width * 3, ((120 + y) * 1920 + 760) * 3, ((120 + y) * 1920 + 760 + width) * 3);
  }
  return cropped;
}

for (const match of config.matches || []) {
  const source = path.join(matchesRoot, `match-${String(match.number).padStart(2, '0')}.mp4`);
  for (const [time, left, right] of match.observations || []) {
    const frame = cropCountHud(await extractRgbFrame(source, time, { width: 1920, height: 1080 }));
    for (const threshold of thresholds) {
      collect(extractDigitGlyphs(frame, 380, countRois.penalty.leftX, countRois.penalty.y, countRois.penalty.width, threshold, countRois.penalty.boxHeight), left);
      collect(extractDigitGlyphs(frame, 380, countRois.penalty.rightX, countRois.penalty.y, countRois.penalty.width, threshold, countRois.penalty.boxHeight), right);
    }
  }
}

const missingDigits = acceptedByDigit.flatMap((count, digit) => count ? [] : [digit]);
if (missingDigits.length) throw new Error(`教師データに数字 ${missingDigits.join(', ')} の有効サンプルがありません`);
await fs.writeFile(outputPath, `${JSON.stringify({
  version: config.version,
  generatedFrom: `${path.basename(configPath)} (${config.recordingId})`,
  samples,
})}\n`);
console.log(JSON.stringify({ outputPath, samples: samples.length, acceptedByDigit, rejected }, null, 2));
