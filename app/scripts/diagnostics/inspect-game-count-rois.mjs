import path from 'node:path';
import { extractRgbFrame } from '../../src/ffmpeg.mjs';
import { extractDigitGlyphs, numberCandidates, rankGlyph } from '../../src/game-count-vision.mjs';

const source = path.resolve(process.argv[2] || '');
const time = Number(process.argv[3] || 120);
if (!source) throw new Error('動画パスを指定してください');

const sourceWidth = 1920;
const sourceHeight = 1080;
const cropX = 760;
const cropY = 120;
const cropWidth = 380;
const cropHeight = 180;
const frame = await extractRgbFrame(source, time, { width: sourceWidth, height: sourceHeight });
const cropped = Buffer.alloc(cropWidth * cropHeight * 3);
for (let y = 0; y < cropHeight; y += 1) {
  frame.copy(
    cropped,
    y * cropWidth * 3,
    ((cropY + y) * sourceWidth + cropX) * 3,
    ((cropY + y) * sourceWidth + cropX + cropWidth) * 3,
  );
}

const thresholds = [95, 105, 118, 130, 145, 160, 175, 190, 'adaptive', 'white'];
function candidatesAt(startX, startY, boxWidth, boxHeight = 48) {
  const byValue = new Map();
  for (const threshold of thresholds) {
    const glyphs = extractDigitGlyphs(cropped, cropWidth, startX, startY, boxWidth, threshold, boxHeight);
    for (const candidate of numberCandidates(glyphs)) {
      const previous = byValue.get(candidate.value);
      const scored = { ...candidate, threshold, glyphs: glyphs.length };
      if (!previous || scored.cost < previous.cost) byValue.set(candidate.value, scored);
    }
  }
  return [...byValue.values()].sort((left, right) => left.cost - right.cost).slice(0, 3);
}

const sides = [
  { side: 'left', xValues: [0, 5, 10, 20, 35, 45, 55], width: 95 },
  { side: 'right', xValues: [260, 265, 270, 275, 280, 285, 290], width: 90 },
];
const results = [];
for (const { side, xValues, width } of sides) {
  for (const boxHeight of [48, 56, 64, 72]) {
    for (const y of [38, 42, 50, 58, 66, 74, 82, 90, 94, 98, 102, 106]) {
      for (const x of xValues) {
        const candidates = candidatesAt(x, y, width, boxHeight);
        if (!candidates.length) continue;
        results.push({ side, x, y, width, boxHeight, candidates });
      }
    }
  }
}

const probes = [];
for (const { side, xValues, width } of sides) {
  const x = xValues[Math.floor(xValues.length / 2)];
  for (const y of [74, 82, 90, 98, 106]) {
    for (const boxHeight of [48, 56, 64, 72]) {
      for (const threshold of [130, 160, 190, 'adaptive', 'white']) {
        const glyphs = extractDigitGlyphs(cropped, cropWidth, x, y, width, threshold, boxHeight);
        probes.push({ side, x, y, width, boxHeight, threshold, glyphs: glyphs.map(glyph => ({
          bounds: glyph.bounds,
          width: glyph.width,
          height: glyph.height,
          pixels: glyph.pixels,
          ranked: rankGlyph(glyph).slice(0, 3),
        })) });
      }
    }
  }
}

console.log(JSON.stringify({ source, time,
  results: results.sort((left, right) => left.candidates[0].cost - right.candidates[0].cost).slice(0, 60),
  probes,
}, null, 2));
