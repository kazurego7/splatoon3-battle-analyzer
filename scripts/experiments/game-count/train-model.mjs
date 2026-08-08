import fs from 'node:fs/promises';
import path from 'node:path';
import { sampleGameCountFrames } from '../../../src/ffmpeg.mjs';
import { countRois, extractDigitGlyphs } from '../../../src/game-count-vision.mjs';

const matchesRoot = path.resolve(process.argv[2] || '../data/matches/2026-08-08-15-20-32-69f2b9f4');
const output = path.resolve(process.argv[3] || '../data/work/count-ocr/templates.json');
const modelOutput = path.resolve(process.argv[4] || 'src/game-count-model.json');
const durations = [382, 296, 280, 356];
const observations = [
  [[20,100,100],[30,91,100],[60,91,59],[120,68,55],[200,68,11]],
  [[20,100,100],[50,79,81],[90,47,68],[140,38,66],[200,38,24],[250,38,9]],
  [[20,100,100],[50,97,83],[90,79,67],[140,51,67],[200,51,30],[240,50,24]],
  [[20,100,100],[50,77,95],[90,65,65],[140,44,65],[220,2,48],[300,2,3]],
];
const examples = Array.from({ length: 10 }, () => []);
const accepted = [];
const rejected = [];
const thresholds = [95, 105, 118, 130, 145, 160, 175, 190, 'adaptive'];

function collect(glyphs, value, context) {
  const digits = String(value).split('').map(Number);
  if (glyphs.length !== digits.length) {
    rejected.push({ ...context, value, expected: digits.length, actual: glyphs.length });
    return;
  }
  glyphs.forEach((glyph, index) => {
    const key = glyph.mask.join('');
    if (!examples[digits[index]].some(item => item.key === key)) examples[digits[index]].push({ ...glyph, key, context });
  });
  accepted.push({ ...context, value });
}

for (let matchIndex = 0; matchIndex < durations.length; matchIndex += 1) {
  const number = matchIndex + 1;
  const samples = await sampleGameCountFrames(path.join(matchesRoot, `match-0${number}.mp4`), durations[matchIndex], {
    onFrame(frame, width, _height, time) {
      return {
        time,
        left: thresholds.map(threshold => ({ threshold, glyphs: extractDigitGlyphs(frame, width, countRois.leftX, countRois.y, countRois.leftWidth, threshold) })),
        right: thresholds.map(threshold => ({ threshold, glyphs: extractDigitGlyphs(frame, width, countRois.rightX, countRois.y, countRois.rightWidth, threshold) })),
      };
    },
  });
  for (const [time, left, right] of observations[matchIndex]) {
    const sample = samples[Math.round(time)];
    sample.left.forEach(variant => collect(variant.glyphs, left, { match: number, time, side: 'left', threshold: variant.threshold }));
    sample.right.forEach(variant => collect(variant.glyphs, right, { match: number, time, side: 'right', threshold: variant.threshold }));
  }
}

function prototype(items, excluded = null) {
  const selected = items.filter(item => item !== excluded);
  const length = selected[0].mask.length;
  return {
    mask: Array.from({ length }, (_, index) => selected.reduce((sum, item) => sum + item.mask[index], 0) / selected.length),
    aspect: selected.reduce((sum, item) => sum + item.width / item.height, 0) / selected.length,
    density: selected.reduce((sum, item) => sum + item.pixels / (item.width * item.height), 0) / selected.length,
    holes: selected.reduce((sum, item) => sum + item.holes, 0) / selected.length,
    centerX: selected.reduce((sum, item) => sum + item.centerX, 0) / selected.length,
    centerY: selected.reduce((sum, item) => sum + item.centerY, 0) / selected.length,
  };
}

function distance(glyph, template) {
  const mask = glyph.mask.reduce((sum, value, index) => sum + Math.abs(value - template.mask[index]), 0) / glyph.mask.length;
  const aspect = Math.abs(glyph.width / glyph.height - template.aspect);
  const density = Math.abs(glyph.pixels / (glyph.width * glyph.height) - template.density);
  const holes = Math.abs(glyph.holes - template.holes);
  const center = Math.abs(glyph.centerX - template.centerX) + Math.abs(glyph.centerY - template.centerY);
  return mask + aspect * 0.45 + density * 0.1 + holes * 0.28 + center * 0.12;
}

function glyphDistance(left, right, weights) {
  const mask = left.mask.reduce((sum, value, index) => sum + Math.abs(value - right.mask[index]), 0) / left.mask.length;
  const aspect = Math.abs(left.width / left.height - right.width / right.height);
  const density = Math.abs(left.pixels / (left.width * left.height) - right.pixels / (right.width * right.height));
  const holes = Math.abs(left.holes - right.holes);
  const center = Math.abs(left.centerX - right.centerX) + Math.abs(left.centerY - right.centerY);
  return mask * weights.mask + aspect * weights.aspect + density * weights.density + holes * weights.holes + center * weights.center;
}

function evaluateNearest(weights) {
  let nearestCorrect = 0;
  let nearestTotal = 0;
  const nearestMistakes = [];
  for (let digit = 0; digit <= 9; digit += 1) {
    for (const glyph of examples[digit]) {
      const scored = examples.flatMap((items, candidate) => items.filter(item => item !== glyph).map(item => ({ candidate, score: glyphDistance(glyph, item, weights) }))).sort((a, b) => a.score - b.score);
      nearestTotal += 1;
      if (scored[0].candidate === digit) nearestCorrect += 1;
      else nearestMistakes.push({ expected: digit, actual: scored[0].candidate, score: scored[0].score, context: glyph.context });
    }
  }
  return { weights, correct: nearestCorrect, total: nearestTotal, accuracy: nearestCorrect / nearestTotal, mistakes: nearestMistakes };
}

const templates = examples.map(items => prototype(items));
let correct = 0;
let total = 0;
const mistakes = [];
for (let digit = 0; digit <= 9; digit += 1) {
  for (const glyph of examples[digit]) {
    const scored = templates.map((template, candidate) => ({
      candidate,
      score: distance(glyph, candidate === digit && examples[digit].length > 1 ? prototype(examples[digit], glyph) : template),
    })).sort((a, b) => a.score - b.score);
    total += 1;
    if (scored[0].candidate === digit) correct += 1;
    else mistakes.push({ expected: digit, actual: scored[0].candidate, score: scored[0].score, context: glyph.context });
  }
}

const payload = {
  version: 1,
  generatedFrom: '2026-08-08 15-20-32.mp4',
  templates: templates.map((template, digit) => ({ digit, examples: examples[digit].length, aspect: template.aspect, density: template.density, holes: template.holes, centerX: template.centerX, centerY: template.centerY, mask: template.mask.map(value => Number(value.toFixed(3))) })),
  samples: examples.map((items, digit) => items.map(item => ({ digit, width: item.width, height: item.height, pixels: item.pixels, holes: item.holes, centerX: item.centerX, centerY: item.centerY, mask: item.mask }))),
};
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, `${JSON.stringify(payload, null, 2)}\n`);
function packedBits(mask) {
  const packed = Buffer.alloc(Math.ceil(mask.length / 8));
  mask.forEach((value, index) => { if (value) packed[Math.floor(index / 8)] |= 1 << (index % 8); });
  return packed.toString('base64');
}
const compactModel = {
  version: 2,
  normalWidth: countRois.normalWidth,
  normalHeight: countRois.normalHeight,
  generatedFrom: '2026-08-08 15-20-32.mp4 multi-threshold observations',
  samples: examples.flatMap((items, digit) => items.map(item => ({
    digit,
    width: item.width,
    height: item.height,
    pixels: item.pixels,
    bits: packedBits(item.mask),
  }))),
};
await fs.writeFile(modelOutput, `${JSON.stringify(compactModel)}\n`);
const nearest = [
  { mask: 1, aspect: 0.18, density: 0.12, holes: 0, center: 0 },
  { mask: 1, aspect: 0.35, density: 0.1, holes: 0, center: 0.08 },
  { mask: 1, aspect: 0.3, density: 0.1, holes: 0.2, center: 0.08 },
].map(evaluateNearest);
console.log(JSON.stringify({ output, modelOutput, accepted: accepted.length, rejected, examples: examples.map(items => items.length), leaveOneOut: { correct, total, accuracy: correct / total, mistakes }, nearest }, null, 2));
