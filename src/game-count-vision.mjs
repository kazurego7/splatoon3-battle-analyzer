import fs from 'node:fs';

const BOX_HEIGHT = 48;
const NORMAL_WIDTH = 16;
const NORMAL_HEIGHT = 28;

function otsuThreshold(values) {
  const histogram = new Array(256).fill(0);
  for (const value of values) histogram[value] += 1;
  const total = values.length;
  const sum = histogram.reduce((result, count, value) => result + count * value, 0);
  let backgroundWeight = 0;
  let backgroundSum = 0;
  let bestVariance = -1;
  let threshold = 128;
  for (let value = 0; value < 256; value += 1) {
    backgroundWeight += histogram[value];
    if (!backgroundWeight) continue;
    const foregroundWeight = total - backgroundWeight;
    if (!foregroundWeight) break;
    backgroundSum += value * histogram[value];
    const backgroundMean = backgroundSum / backgroundWeight;
    const foregroundMean = (sum - backgroundSum) / foregroundWeight;
    const variance = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      threshold = value;
    }
  }
  return threshold;
}

function projectionRuns(values, minimum = 2) {
  const runs = [];
  let start = null;
  let lastActive = null;
  for (let index = 0; index <= values.length; index += 1) {
    const active = index < values.length && values[index] >= minimum;
    if (active) {
      if (start == null) start = index;
      lastActive = index;
      continue;
    }
    if (start != null && index - lastActive <= 2 && index < values.length) continue;
    if (start != null) {
      if (lastActive - start + 1 >= 4) runs.push([start, lastActive]);
      start = null;
      lastActive = null;
    }
  }
  return runs;
}

function normalizedMask(mask, width, height, bounds) {
  const [left, top, right, bottom] = bounds;
  const sourceWidth = Math.max(1, right - left + 1);
  const sourceHeight = Math.max(1, bottom - top + 1);
  const result = new Array(NORMAL_WIDTH * NORMAL_HEIGHT).fill(0);
  for (let y = 0; y < NORMAL_HEIGHT; y += 1) {
    for (let x = 0; x < NORMAL_WIDTH; x += 1) {
      const sourceX = Math.min(right, left + Math.floor((x + 0.5) * sourceWidth / NORMAL_WIDTH));
      const sourceY = Math.min(bottom, top + Math.floor((y + 0.5) * sourceHeight / NORMAL_HEIGHT));
      result[y * NORMAL_WIDTH + x] = mask[sourceY * width + sourceX] ? 1 : 0;
    }
  }
  return result;
}

function glyphFeatures(mask, width, height, bounds) {
  const [left, top, right, bottom] = bounds;
  const localWidth = right - left + 1;
  const localHeight = bottom - top + 1;
  const visited = new Uint8Array(localWidth * localHeight);
  let holes = 0;
  for (let localY = 0; localY < localHeight; localY += 1) {
    for (let localX = 0; localX < localWidth; localX += 1) {
      const localAt = localY * localWidth + localX;
      if (visited[localAt] || mask[(top + localY) * width + left + localX]) continue;
      const queue = [[localX, localY]];
      visited[localAt] = 1;
      let touchesEdge = false;
      let size = 0;
      while (queue.length) {
        const [x, y] = queue.pop();
        size += 1;
        if (x === 0 || y === 0 || x === localWidth - 1 || y === localHeight - 1) touchesEdge = true;
        for (const [nextX, nextY] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
          if (nextX < 0 || nextY < 0 || nextX >= localWidth || nextY >= localHeight) continue;
          const nextAt = nextY * localWidth + nextX;
          if (visited[nextAt] || mask[(top + nextY) * width + left + nextX]) continue;
          visited[nextAt] = 1;
          queue.push([nextX, nextY]);
        }
      }
      if (!touchesEdge && size >= 4) holes += 1;
    }
  }

  let pixels = 0;
  let sumX = 0;
  let sumY = 0;
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      if (!mask[y * width + x]) continue;
      pixels += 1;
      sumX += (x - left) / localWidth;
      sumY += (y - top) / localHeight;
    }
  }
  return { holes, pixels, centerX: sumX / pixels, centerY: sumY / pixels };
}

export function extractDigitGlyphs(frame, frameWidth, startX, startY = 42, boxWidth = 85, thresholdMode = 'adaptive') {
  const mask = new Uint8Array(boxWidth * BOX_HEIGHT);
  const columns = new Array(boxWidth).fill(0);
  const lumas = new Uint8Array(boxWidth * BOX_HEIGHT);
  for (let y = 0; y < BOX_HEIGHT; y += 1) {
    for (let x = 0; x < boxWidth; x += 1) {
      const at = ((startY + y) * frameWidth + startX + x) * 3;
      lumas[y * boxWidth + x] = Math.round(frame[at] * 0.299 + frame[at + 1] * 0.587 + frame[at + 2] * 0.114);
    }
  }
  const threshold = typeof thresholdMode === 'number'
    ? thresholdMode
    : thresholdMode === 'fixed' ? 118 : Math.max(105, otsuThreshold(lumas) + 20);
  for (let y = 0; y < BOX_HEIGHT; y += 1) {
    for (let x = 0; x < boxWidth; x += 1) {
      if (lumas[y * boxWidth + x] < threshold) continue;
      mask[y * boxWidth + x] = 1;
      columns[x] += 1;
    }
  }

  return projectionRuns(columns).map(([left, right]) => {
    let top = BOX_HEIGHT;
    let bottom = -1;
    let pixels = 0;
    for (let y = 0; y < BOX_HEIGHT; y += 1) {
      for (let x = left; x <= right; x += 1) {
        if (!mask[y * boxWidth + x]) continue;
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
        pixels += 1;
      }
    }
    if (bottom < top || bottom - top < 18 || pixels < 45) return null;
    if (right - left + 1 > 32) return null;
    const features = glyphFeatures(mask, boxWidth, BOX_HEIGHT, [left, top, right, bottom]);
    return {
      bounds: [left, top, right, bottom],
      width: right - left + 1,
      height: bottom - top + 1,
      pixels,
      holes: features.holes,
      centerX: features.centerX,
      centerY: features.centerY,
      mask: normalizedMask(mask, boxWidth, BOX_HEIGHT, [left, top, right, bottom]),
    };
  }).filter(Boolean);
}

export const countRois = {
  width: 380,
  height: 100,
  leftX: 45,
  rightX: 280,
  y: 42,
  leftWidth: 85,
  rightWidth: 63,
  leftThreshold: 'adaptive',
  rightThreshold: 'fixed',
  boxHeight: BOX_HEIGHT,
  normalWidth: NORMAL_WIDTH,
  normalHeight: NORMAL_HEIGHT,
};

const model = JSON.parse(fs.readFileSync(new URL('./game-count-model.json', import.meta.url), 'utf8'));
export const gameCountModelVersion = model.version;
const modelSamples = model.samples.map(sample => {
  const packed = Buffer.from(sample.bits, 'base64');
  const mask = new Uint8Array(model.normalWidth * model.normalHeight);
  for (let index = 0; index < mask.length; index += 1) mask[index] = (packed[Math.floor(index / 8)] >> (index % 8)) & 1;
  return { ...sample, mask };
});

function glyphDistance(left, right) {
  let mask = 0;
  for (let index = 0; index < left.mask.length; index += 1) mask += Math.abs(left.mask[index] - right.mask[index]);
  mask /= left.mask.length;
  const aspect = Math.abs(left.width / left.height - right.width / right.height);
  const density = Math.abs(left.pixels / (left.width * left.height) - right.pixels / (right.width * right.height));
  return mask + aspect * 0.18 + density * 0.12;
}

function rankGlyph(glyph) {
  const best = new Map();
  for (const sample of modelSamples) {
    const score = glyphDistance(glyph, sample);
    if (!best.has(sample.digit) || score < best.get(sample.digit)) best.set(sample.digit, score);
  }
  return [...best.entries()]
    .map(([digit, score]) => ({ digit, score }))
    .sort((left, right) => left.score - right.score)
    .slice(0, 3);
}

function numberCandidates(glyphs) {
  if (!glyphs.length || glyphs.length > 3) return [];
  let combinations = [{ text: '', cost: 0 }];
  for (const glyph of glyphs) {
    const ranked = rankGlyph(glyph);
    if (!ranked.length || ranked[0].score > 0.48) return [];
    combinations = combinations.flatMap(combination => ranked.map(candidate => ({
      text: `${combination.text}${candidate.digit}`,
      cost: combination.cost + candidate.score,
    })));
  }
  return combinations
    .filter(candidate => candidate.text === '0' || !candidate.text.startsWith('0'))
    .map(candidate => ({ value: Number(candidate.text), cost: candidate.cost / glyphs.length }))
    .filter(candidate => candidate.value >= 0 && candidate.value <= 100)
    .sort((left, right) => left.cost - right.cost)
    .slice(0, 12);
}

function multiThresholdCandidates(frame, frameWidth, startX, boxWidth) {
  const byValue = new Map();
  for (const threshold of [95, 105, 118, 130, 145, 160, 175, 190, 'adaptive']) {
    const glyphs = extractDigitGlyphs(frame, frameWidth, startX, countRois.y, boxWidth, threshold);
    for (const candidate of numberCandidates(glyphs)) {
      const thresholdPenalty = threshold === 'adaptive' ? 0 : Math.abs(Number(threshold) - 140) / 2500;
      const scored = { ...candidate, cost: candidate.cost + thresholdPenalty, threshold, glyphs: glyphs.length };
      const previous = byValue.get(candidate.value);
      if (!previous || scored.cost < previous.cost) byValue.set(candidate.value, scored);
    }
  }
  return [...byValue.values()].sort((left, right) => left.cost - right.cost).slice(0, 18);
}

export function analyzeGameCountFrame(frame, frameWidth, time) {
  return {
    time,
    left: multiThresholdCandidates(frame, frameWidth, countRois.leftX, countRois.leftWidth),
    right: multiThresholdCandidates(frame, frameWidth, countRois.rightX, countRois.rightWidth),
  };
}

function bestBeamEntry(map, key, candidate) {
  const current = map.get(key);
  if (!current || candidate.cost < current.cost) map.set(key, candidate);
}

export function stabilizeGameCount(samples, side, { gameplayStart = 10, gameplayEnd = Infinity } = {}) {
  const relevant = samples.filter(sample => sample.time >= gameplayStart && sample.time <= gameplayEnd);
  let beam = [{ value: 100, cost: 0, lastObservedTime: gameplayStart, path: [] }];
  for (const sample of relevant) {
    const observations = sample[side] || [];
    const next = new Map();
    for (const entry of beam) {
      bestBeamEntry(next, `${entry.value}:${entry.lastObservedTime}`, {
        value: entry.value,
        cost: entry.cost + (observations.length ? 0.22 : 0.025),
        lastObservedTime: entry.lastObservedTime,
        path: [...entry.path, { time: sample.time, value: entry.value, source: 'held', confidence: observations.length ? 0.55 : 0.35 }],
      });
      for (const observation of observations) {
        const drop = entry.value - observation.value;
        const elapsed = Math.max(1, sample.time - entry.lastObservedTime);
        if (drop < 0 || drop > Math.max(3, Math.ceil(elapsed * 2.2))) continue;
        bestBeamEntry(next, `${observation.value}:${sample.time}`, {
          value: observation.value,
          cost: entry.cost + observation.cost + drop * 0.025,
          lastObservedTime: sample.time,
          path: [...entry.path, { time: sample.time, value: observation.value, source: 'observed', confidence: Math.max(0.35, Math.min(0.98, 1 - observation.cost / 0.5)) }],
        });
      }
    }
    beam = [...next.values()].sort((left, right) => left.cost - right.cost).slice(0, 35);
  }
  return beam.sort((left, right) => left.cost - right.cost)[0]?.path || [];
}

export function detectGameCounts(samples, options = {}) {
  const team = stabilizeGameCount(samples, 'left', options);
  const enemy = stabilizeGameCount(samples, 'right', options);
  const enemyByTime = new Map(enemy.map(item => [item.time, item]));
  return team.map(item => {
    const other = enemyByTime.get(item.time);
    return {
      time: item.time,
      teamCount: item.value,
      enemyCount: other?.value ?? 100,
      teamSource: item.source,
      enemySource: other?.source ?? 'held',
      confidence: Math.min(item.confidence, other?.confidence ?? 0.35),
    };
  });
}
