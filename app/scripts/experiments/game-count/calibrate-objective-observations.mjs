import fs from 'node:fs/promises';
import path from 'node:path';
import { extractRgbFrame } from '../../../src/ffmpeg.mjs';
import { extractObjectiveDigitGlyphs, gameCountFrameRegionForRule } from '../../../src/game-count-vision.mjs';

const configPath = path.resolve(process.argv[2] || 'config/game-count-objective-calibration-observations.json');
const outputPath = path.resolve(process.argv[3] || 'src/game-count-objective-model.json');
const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
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

function cropFrame(frame, region) {
  const cropped = Buffer.alloc(region.width * region.height * 3);
  for (let y = 0; y < region.height; y += 1) {
    frame.copy(
      cropped,
      y * region.width * 3,
      ((region.y + y) * 1920 + region.x) * 3,
      ((region.y + y) * 1920 + region.x + region.width) * 3,
    );
  }
  return cropped;
}

for (const recording of config.recordings || []) {
  const matchesRoot = path.resolve(path.dirname(configPath), recording.matchesRoot);
  for (const match of recording.matches || []) {
    const source = path.join(matchesRoot, `match-${String(match.number).padStart(2, '0')}.mp4`);
    const region = gameCountFrameRegionForRule(match.rule);
    for (const [time, left, right] of match.observations || []) {
      const frame = cropFrame(await extractRgbFrame(source, time, { width: 1920, height: 1080 }), region);
      for (const [side, value] of [['left', left], ['right', right]]) {
        if (value == null) continue;
        for (const result of extractObjectiveDigitGlyphs(frame, region.width, side, value)) collect(result.glyphs, value);
      }
    }
  }
}

await fs.writeFile(outputPath, `${JSON.stringify({
  version: config.version,
  generatedFrom: path.basename(configPath),
  samples,
})}\n`);
console.log(JSON.stringify({ outputPath, samples: samples.length, acceptedByDigit, rejected }, null, 2));
