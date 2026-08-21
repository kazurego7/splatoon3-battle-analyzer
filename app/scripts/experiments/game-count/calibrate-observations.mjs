import fs from 'node:fs/promises';
import path from 'node:path';
import { sampleGameCountFrames } from '../../../src/ffmpeg.mjs';
import { countRois, extractDigitGlyphs, extractObjectiveDigitGlyphs, gameCountFrameRegionForRule } from '../../../src/game-count-vision.mjs';

const configPath = path.resolve(process.argv[2] || 'config/game-count-calibration-observations.json');
const outputPath = path.resolve(process.argv[3] || 'src/game-count-calibration-model.json');
const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
const previous = JSON.parse(await fs.readFile(outputPath, 'utf8'));
const thresholds = [95, 105, 118, 130, 145, 160, 175, 190, 'adaptive', 'white'];
const samples = (previous.samples || []).slice(0, config.baseSampleCount ?? previous.samples.length);
const known = new Set(samples.map(sample => `${sample.digit}:${sample.bits}`));
let accepted = 0;
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
    if (!known.has(key)) {
      samples.push(sample);
      known.add(key);
      accepted += 1;
    }
  });
}

for (const recording of config.recordings || []) {
  const matchesRoot = path.resolve(path.dirname(configPath), recording.matchesRoot);
  for (const match of recording.matches || []) {
    const wanted = new Map(match.observations.map(([time, left, right]) => [time, { left, right }]));
    const region = gameCountFrameRegionForRule(match.rule);
    await sampleGameCountFrames(path.join(matchesRoot, `match-${String(match.number).padStart(2, '0')}.mp4`), match.duration, {
      interval: match.interval || 1,
      crop: region,
      onFrame(frame, width, _height, time) {
        const observation = wanted.get(time);
        if (!observation) return { time };
        if (match.rule === 'ヤグラ' || match.rule === 'ホコ') {
          for (const [side, value] of [['left', observation.left], ['right', observation.right]]) {
            if (value == null) continue;
            for (const result of extractObjectiveDigitGlyphs(frame, width, side, value)) collect(result.glyphs, value);
          }
        } else {
          for (const threshold of thresholds) {
            collect(extractDigitGlyphs(frame, width, countRois.leftX, countRois.y, countRois.leftWidth, threshold), observation.left);
            collect(extractDigitGlyphs(frame, width, countRois.rightX, countRois.y, countRois.rightWidth, threshold), observation.right);
          }
        }
        return { time };
      },
    });
  }
}

await fs.writeFile(outputPath, `${JSON.stringify({
  version: config.version,
  generatedFrom: `${previous.generatedFrom}; verified observations in ${path.basename(configPath)}`,
  samples,
})}\n`);
console.log(JSON.stringify({ outputPath, accepted, rejected, total: samples.length }, null, 2));
