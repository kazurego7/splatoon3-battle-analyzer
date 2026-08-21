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
    if (start != null && index - lastActive <= 1 && index < values.length) continue;
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

export function extractDigitGlyphs(frame, frameWidth, startX, startY = 42, boxWidth = 85, thresholdMode = 'adaptive', boxHeight = BOX_HEIGHT) {
  const mask = new Uint8Array(boxWidth * boxHeight);
  const columns = new Array(boxWidth).fill(0);
  const lumas = new Uint8Array(boxWidth * boxHeight);
  for (let y = 0; y < boxHeight; y += 1) {
    for (let x = 0; x < boxWidth; x += 1) {
      const at = ((startY + y) * frameWidth + startX + x) * 3;
      lumas[y * boxWidth + x] = Math.round(frame[at] * 0.299 + frame[at + 1] * 0.587 + frame[at + 2] * 0.114);
    }
  }
  const whiteOnly = thresholdMode === 'white';
  const threshold = typeof thresholdMode === 'number'
    ? thresholdMode
    : thresholdMode === 'fixed' ? 118 : whiteOnly ? 155 : Math.max(105, otsuThreshold(lumas) + 20);
  for (let y = 0; y < boxHeight; y += 1) {
    for (let x = 0; x < boxWidth; x += 1) {
      if (lumas[y * boxWidth + x] < threshold) continue;
      if (whiteOnly) {
        const at = ((startY + y) * frameWidth + startX + x) * 3;
        const maximum = Math.max(frame[at], frame[at + 1], frame[at + 2]);
        const minimum = Math.min(frame[at], frame[at + 1], frame[at + 2]);
        if (maximum - minimum > 72) continue;
      }
      mask[y * boxWidth + x] = 1;
      columns[x] += 1;
    }
  }

  return projectionRuns(columns).map(([left, right]) => {
    let top = boxHeight;
    let bottom = -1;
    let pixels = 0;
    for (let y = 0; y < boxHeight; y += 1) {
      for (let x = left; x <= right; x += 1) {
        if (!mask[y * boxWidth + x]) continue;
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
        pixels += 1;
      }
    }
    const minimumHeight = boxHeight === BOX_HEIGHT ? 19 : Math.max(5, Math.floor(boxHeight * 0.25));
    const minimumPixels = boxHeight === BOX_HEIGHT ? 45 : Math.max(6, Math.floor(boxHeight * 0.5));
    if (bottom < top || bottom - top + 1 < minimumHeight || pixels < minimumPixels) return null;
    if (right - left + 1 > 32) return null;
    const features = glyphFeatures(mask, boxWidth, boxHeight, [left, top, right, bottom]);
    return {
      bounds: [left, top, right, bottom],
      width: right - left + 1,
      height: bottom - top + 1,
      pixels,
      holes: features.holes,
      centerX: features.centerX,
      centerY: features.centerY,
      mask: normalizedMask(mask, boxWidth, boxHeight, [left, top, right, bottom]),
    };
  }).filter(Boolean);
}

export const countRois = {
  width: 380,
  height: 180,
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
  penalty: {
    y: 88,
    boxHeight: 45,
    leftX: 105,
    rightX: 280,
    width: 45,
    plusY: 98,
    plusHeight: 34,
    leftPlusX: 80,
    rightPlusX: 255,
    plusWidth: 26,
  },
};

export const countUiProfiles = {
  scoreCard: {
    id: 'score-card',
    leftX: 45,
    rightX: 280,
    y: 42,
    leftWidth: 85,
    rightWidth: 63,
    boxHeight: BOX_HEIGHT,
  },
  objectiveMarker: {
    id: 'objective-marker',
    dynamic: true,
    // This profile uses a wide, short source crop of the objective progress
    // line. The two count markers move horizontally as the objective advances.
    leftX: 0,
    rightX: 400,
    y: 88,
    leftWidth: 600,
    rightWidth: 600,
    boxHeight: 55,
  },
};

const OBJECTIVE_MARKER_RULES = new Set(['ヤグラ', 'ホコ']);
const PENALTY_RULES = new Set(['エリア', 'アサリ']);

export function countUiProfileForRule(rule) {
  return OBJECTIVE_MARKER_RULES.has(rule) ? countUiProfiles.objectiveMarker : countUiProfiles.scoreCard;
}

export function gameCountFrameRegionForRule(rule) {
  return OBJECTIVE_MARKER_RULES.has(rule)
    ? { x: 460, y: 135, width: 1000, height: 150 }
    : { x: 760, y: 120, width: 380, height: 180 };
}

function detectObjectiveProgressLine(frame, frameWidth) {
  let bestRuns = 0;
  let bestSpan = 0;
  let bestY = null;
  for (let y = 5; y < Math.min(65, Math.floor(frame.length / (frameWidth * 3))); y += 1) {
    const runs = [];
    let start = null;
    for (let x = 0; x <= frameWidth; x += 1) {
      let dark = false;
      if (x < frameWidth) {
        const at = (y * frameWidth + x) * 3;
        const luma = frame[at] * 0.299 + frame[at + 1] * 0.587 + frame[at + 2] * 0.114;
        dark = luma < 58;
      }
      if (dark && start == null) start = x;
      if (!dark && start != null) {
        const width = x - start;
        if (width >= 3 && width <= 20) runs.push([start, x - 1]);
        start = null;
      }
    }
    if (runs.length > bestRuns) {
      bestRuns = runs.length;
      bestSpan = runs.length ? runs.at(-1)[1] - runs[0][0] : 0;
      bestY = y;
    }
  }
  return { visible: bestRuns >= 25 && bestSpan >= 420, bestRuns, bestSpan, bestY };
}

export function ruleHasVisiblePenalty(rule) {
  return rule == null || rule === '' || PENALTY_RULES.has(rule);
}

const model = JSON.parse(fs.readFileSync(new URL('./game-count-model.json', import.meta.url), 'utf8'));
const calibration = JSON.parse(fs.readFileSync(new URL('./game-count-calibration-model.json', import.meta.url), 'utf8'));
const penaltyCalibration = JSON.parse(fs.readFileSync(new URL('./game-penalty-calibration-model.json', import.meta.url), 'utf8'));
const objectiveCalibration = JSON.parse(fs.readFileSync(new URL('./game-count-objective-model.json', import.meta.url), 'utf8'));
export const gameCountModelVersion = `${model.version}-calibration-${calibration.version}-objective-${objectiveCalibration.version}-penalty-${penaltyCalibration.version}-rule-ui-v1-instant-count-v5-2hz`;
function unpackSamples(samples) {
  return samples.map(sample => {
  const packed = Buffer.from(sample.bits, 'base64');
  const mask = new Uint8Array(model.normalWidth * model.normalHeight);
  for (let index = 0; index < mask.length; index += 1) mask[index] = (packed[Math.floor(index / 8)] >> (index % 8)) & 1;
  return { ...sample, mask };
  });
}
const baseModelSamples = unpackSamples(model.samples);
const modelSamples = [...baseModelSamples, ...unpackSamples(calibration.samples)];
const penaltyModelSamples = [...baseModelSamples, ...unpackSamples(penaltyCalibration.samples)];
const objectiveModelSamples = [...modelSamples, ...unpackSamples(objectiveCalibration.samples)];

function glyphDistance(left, right) {
  let mask = 0;
  for (let index = 0; index < left.mask.length; index += 1) mask += Math.abs(left.mask[index] - right.mask[index]);
  mask /= left.mask.length;
  const aspect = Math.abs(left.width / left.height - right.width / right.height);
  const density = Math.abs(left.pixels / (left.width * left.height) - right.pixels / (right.width * right.height));
  return mask + aspect * 0.18 + density * 0.12;
}

export function rankGlyph(glyph, useCalibration = true) {
  const best = new Map();
  const samples = useCalibration === 'penalty'
    ? penaltyModelSamples
    : useCalibration === 'objective'
      ? objectiveModelSamples
      : useCalibration ? modelSamples : baseModelSamples;
  for (const sample of samples) {
    const score = glyphDistance(glyph, sample);
    if (!best.has(sample.digit) || score < best.get(sample.digit)) best.set(sample.digit, score);
  }
  return [...best.entries()]
    .map(([digit, score]) => ({ digit, score }))
    .sort((left, right) => left.score - right.score)
    .slice(0, 3);
}

export function numberCandidates(glyphs, useCalibration = true) {
  if (!glyphs.length || glyphs.length > 3) return [];
  let combinations = [{ text: '', cost: 0 }];
  for (const glyph of glyphs) {
    const ranked = rankGlyph(glyph, useCalibration);
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

function multiThresholdCandidates(frame, frameWidth, startX, boxWidth, { y = countRois.y, boxHeight = BOX_HEIGHT, maximum = 100, useCalibration = true } = {}) {
  const byValue = new Map();
  const supportByValue = new Map();
  for (const threshold of [95, 105, 118, 130, 145, 160, 175, 190, 'adaptive', 'white']) {
    const glyphs = extractDigitGlyphs(frame, frameWidth, startX, y, boxWidth, threshold, boxHeight);
    for (const candidate of numberCandidates(glyphs, useCalibration)) {
      if (candidate.value > maximum) continue;
      const thresholdPenalty = threshold === 'adaptive' || threshold === 'white' ? 0 : Math.abs(Number(threshold) - 140) / 2500;
      const scored = { ...candidate, cost: candidate.cost + thresholdPenalty, threshold, glyphs: glyphs.length };
      supportByValue.set(candidate.value, (supportByValue.get(candidate.value) || 0) + 1);
      const previous = byValue.get(candidate.value);
      if (!previous || scored.cost < previous.cost) byValue.set(candidate.value, scored);
    }
  }
  return [...byValue.values()]
    .map(candidate => ({ ...candidate, support: supportByValue.get(candidate.value) || 1 }))
    .sort((left, right) => left.cost - right.cost || right.support - left.support)
    .slice(0, 18);
}

function extractConnectedDigitGlyphs(frame, frameWidth, startX, startY, boxWidth, thresholdMode, boxHeight) {
  const mask = new Uint8Array(boxWidth * boxHeight);
  const lumas = new Uint8Array(boxWidth * boxHeight);
  for (let y = 0; y < boxHeight; y += 1) {
    for (let x = 0; x < boxWidth; x += 1) {
      const at = ((startY + y) * frameWidth + startX + x) * 3;
      lumas[y * boxWidth + x] = Math.round(frame[at] * 0.299 + frame[at + 1] * 0.587 + frame[at + 2] * 0.114);
    }
  }
  const whiteOnly = thresholdMode === 'white';
  const threshold = typeof thresholdMode === 'number' ? thresholdMode : Math.max(155, otsuThreshold(lumas) + 20);
  for (let y = 0; y < boxHeight; y += 1) {
    for (let x = 0; x < boxWidth; x += 1) {
      if (lumas[y * boxWidth + x] < threshold) continue;
      if (whiteOnly) {
        const at = ((startY + y) * frameWidth + startX + x) * 3;
        const maximum = Math.max(frame[at], frame[at + 1], frame[at + 2]);
        const minimum = Math.min(frame[at], frame[at + 1], frame[at + 2]);
        if (maximum - minimum > 72) continue;
      }
      mask[y * boxWidth + x] = 1;
    }
  }

  const visited = new Uint8Array(mask.length);
  const glyphs = [];
  for (let origin = 0; origin < mask.length; origin += 1) {
    if (!mask[origin] || visited[origin]) continue;
    const queue = [origin];
    visited[origin] = 1;
    let left = boxWidth;
    let right = -1;
    let top = boxHeight;
    let bottom = -1;
    let pixels = 0;
    while (queue.length) {
      const at = queue.pop();
      const x = at % boxWidth;
      const y = Math.floor(at / boxWidth);
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
      pixels += 1;
      for (const [nextX, nextY] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1], [x - 1, y - 1], [x + 1, y - 1], [x - 1, y + 1], [x + 1, y + 1]]) {
        if (nextX < 0 || nextY < 0 || nextX >= boxWidth || nextY >= boxHeight) continue;
        const next = nextY * boxWidth + nextX;
        if (!mask[next] || visited[next]) continue;
        visited[next] = 1;
        queue.push(next);
      }
    }
    const width = right - left + 1;
    const height = bottom - top + 1;
    if (width < 4 || width > 40 || height < 24 || pixels < 45) continue;
    glyphs.push({
      bounds: [left, top, right, bottom],
      width,
      height,
      pixels,
      holes: 0,
      centerX: 0.5,
      centerY: 0.5,
      mask: normalizedMask(mask, boxWidth, boxHeight, [left, top, right, bottom]),
    });
  }
  return glyphs.sort((left, right) => left.bounds[0] - right.bounds[0]);
}

function groupNearbyGlyphs(glyphs) {
  const groups = [];
  let group = [];
  for (const glyph of glyphs) {
    const previous = group.at(-1);
    const gap = previous ? glyph.bounds[0] - previous.bounds[2] - 1 : 0;
    if (previous && gap > 40) {
      if (group.length) groups.push(group);
      group = [];
    }
    group.push(glyph);
  }
  if (group.length) groups.push(group);
  return groups;
}

export function extractObjectiveDigitGlyphs(frame, frameWidth, side, value) {
  const profile = countUiProfiles.objectiveMarker;
  const startX = side === 'left' ? profile.leftX : profile.rightX;
  const boxWidth = side === 'left' ? profile.leftWidth : profile.rightWidth;
  const digitCount = String(value).length;
  const expectedCenter = side === 'left' ? value * 5 : 500 + (100 - value) * 5;
  const results = [];
  for (const threshold of [145, 160, 175, 190, 'white']) {
    const glyphs = extractConnectedDigitGlyphs(frame, frameWidth, startX, profile.y, boxWidth, threshold, profile.boxHeight);
    const candidates = [];
    for (const group of groupNearbyGlyphs(glyphs)) {
      for (let first = 0; first + digitCount <= group.length; first += 1) {
        const selected = group.slice(first, first + digitCount);
        const x = startX + selected[0].bounds[0];
        const spanWidth = selected.at(-1).bounds[2] - selected[0].bounds[0] + 1;
        const positionError = Math.abs(x + spanWidth / 2 - expectedCenter);
        candidates.push({ glyphs: selected, positionError });
      }
    }
    const selected = candidates.sort((left, right) => left.positionError - right.positionError)[0];
    if (selected && selected.positionError <= 110) results.push({ threshold, ...selected });
  }
  return results;
}

function dynamicObjectiveCandidates(frame, frameWidth, startX, boxWidth, { y, boxHeight, side }) {
  const byValue = new Map();
  const supportByValue = new Map();
  for (const threshold of [145, 160, 175, 190, 'white']) {
    const glyphs = extractConnectedDigitGlyphs(frame, frameWidth, startX, y, boxWidth, threshold, boxHeight);
    const groups = groupNearbyGlyphs(glyphs);
    for (const cluster of groups) {
      for (let first = 0; first < cluster.length; first += 1) {
        for (let length = 1; length <= 3 && first + length <= cluster.length; length += 1) {
          const selected = cluster.slice(first, first + length);
          for (const candidate of numberCandidates(selected, 'objective')) {
            const heights = selected.map(glyph => glyph.height);
            const alignmentPenalty = (Math.max(...heights) - Math.min(...heights)) / 300;
            const scored = {
              ...candidate,
              cost: candidate.cost + alignmentPenalty,
              threshold,
              glyphs: selected.length,
              x: startX + selected[0].bounds[0],
              spanWidth: selected.at(-1).bounds[2] - selected[0].bounds[0] + 1,
            };
            const center = scored.x + scored.spanWidth / 2;
            const expectedCenter = side === 'left'
              ? candidate.value * 5
              : 500 + (100 - candidate.value) * 5;
            const positionError = Math.abs(center - expectedCenter);
            if (positionError > 110) continue;
            scored.positionError = positionError;
            supportByValue.set(candidate.value, (supportByValue.get(candidate.value) || 0) + 1);
            const previous = byValue.get(candidate.value);
            if (!previous || scored.cost < previous.cost) byValue.set(candidate.value, scored);
          }
        }
      }
    }
  }
  return [...byValue.values()]
    .map(candidate => ({ ...candidate, support: supportByValue.get(candidate.value) || 1 }))
    .sort((left, right) => left.cost - right.cost || right.glyphs - left.glyphs || right.support - left.support)
    .slice(0, 24);
}

function deconflictObjectiveCandidates(leftCandidates, rightCandidates) {
  const center = candidate => candidate.x + candidate.spanWidth / 2;
  const overlaps = (candidate, others) => others.filter(other => Math.abs(center(candidate) - center(other)) <= 40);
  return {
    left: leftCandidates.filter(candidate => {
      const matches = overlaps(candidate, rightCandidates);
      return !matches.length || Math.min(center(candidate), ...matches.map(center)) <= 500;
    }),
    right: rightCandidates.filter(candidate => {
      const matches = overlaps(candidate, leftCandidates);
      return !matches.length || Math.min(center(candidate), ...matches.map(center)) > 500;
    }),
  };
}

export function detectPenaltyPresence(frame, frameWidth, side) {
  const roi = countRois.penalty;
  const plusX = side === 'left' ? roi.leftPlusX : roi.rightPlusX;
  const pillLeft = plusX - 20;
  let dark = 0;
  let pillPixels = 0;
  for (let y = 92; y < 145; y += 1) {
    for (let x = pillLeft; x < pillLeft + 95; x += 1) {
      const at = (y * frameWidth + x) * 3;
      const luma = frame[at] * 0.299 + frame[at + 1] * 0.587 + frame[at + 2] * 0.114;
      if (luma < 70) dark += 1;
      pillPixels += 1;
    }
  }
  const rowWhites = [];
  const columnWhites = new Array(roi.plusWidth).fill(0);
  let whitePixels = 0;
  for (let y = roi.plusY; y < roi.plusY + roi.plusHeight; y += 1) {
    let rowWhite = 0;
    for (let localX = 0; localX < roi.plusWidth; localX += 1) {
      const x = plusX + localX;
      const at = (y * frameWidth + x) * 3;
      const luma = frame[at] * 0.299 + frame[at + 1] * 0.587 + frame[at + 2] * 0.114;
      if (luma <= 180) continue;
      rowWhite += 1;
      columnWhites[localX] += 1;
      whitePixels += 1;
    }
    rowWhites.push(rowWhite);
  }
  const darkRatio = dark / Math.max(1, pillPixels);
  const strongRows = rowWhites.filter(value => value >= 15).length;
  const strongColumns = columnWhites.filter(value => value >= 15).length;
  return darkRatio >= 0.15
    && whitePixels >= 100 && whitePixels <= 350
    && Math.max(...rowWhites) >= 15 && Math.max(...rowWhites) <= 23
    && Math.max(...columnWhites) >= 15 && Math.max(...columnWhites) <= 23
    && strongRows >= 3 && strongColumns >= 3;
}

function penaltyObservation(frame, frameWidth, side) {
  const visible = detectPenaltyPresence(frame, frameWidth, side);
  if (!visible) return { visible: false, candidates: [] };
  const roi = countRois.penalty;
  const startX = side === 'left' ? roi.leftX : roi.rightX;
  return {
    visible: true,
    candidates: multiThresholdCandidates(frame, frameWidth, startX, roi.width, {
      y: roi.y,
      boxHeight: roi.boxHeight,
      maximum: 99,
      useCalibration: 'penalty',
    }),
  };
}

export function analyzeGameCountFrame(frame, frameWidth, time, { rule = null } = {}) {
  const profile = countUiProfileForRule(rule);
  const hasPenalty = ruleHasVisiblePenalty(rule);
  const countCandidates = profile.dynamic ? dynamicObjectiveCandidates : multiThresholdCandidates;
  const objectiveLine = profile.dynamic ? detectObjectiveProgressLine(frame, frameWidth) : null;
  let rawLeft = countCandidates(frame, frameWidth, profile.leftX, profile.leftWidth, {
    y: profile.y,
    boxHeight: profile.boxHeight,
    side: 'left',
  });
  let rawRight = countCandidates(frame, frameWidth, profile.rightX, profile.rightWidth, {
    y: profile.y,
    boxHeight: profile.boxHeight,
    side: 'right',
  });
  if (profile.dynamic) {
    ({ left: rawLeft, right: rawRight } = deconflictObjectiveCandidates(rawLeft, rawRight));
  }
  const highCountPanel = candidates => candidates.some(candidate =>
    candidate.value >= 40 && candidate.glyphs >= 2 && candidate.cost <= 0.28);
  const objectiveVisible = !profile.dynamic
    || objectiveLine.visible
    || (highCountPanel(rawLeft) && highCountPanel(rawRight));
  return {
    time,
    countUiProfile: profile.id,
    objectiveVisible,
    objectiveLine,
    left: objectiveVisible ? rawLeft : [],
    right: objectiveVisible ? rawRight : [],
    leftPenalty: hasPenalty ? penaltyObservation(frame, frameWidth, 'left') : { visible: false, candidates: [] },
    rightPenalty: hasPenalty ? penaltyObservation(frame, frameWidth, 'right') : { visible: false, candidates: [] },
  };
}

function stabilizeObjectiveGameCount(samples, side, { gameplayStart = 10, gameplayEnd = Infinity, rule }) {
  const relevant = samples.filter(sample => sample.time >= gameplayStart && sample.time <= gameplayEnd);
  if (!relevant.length) return [];
  const observations = relevant.map(sample => {
    const byValue = new Map();
    const credibleMultiDigit = (sample[side] || []).some(candidate => candidate.value >= 10 && candidate.cost <= 0.3);
    for (const candidate of sample[side] || []) {
      let cost = candidate.cost - Math.min(0.04, Math.max(0, (candidate.support || 1) - 1) * 0.008);
      if (candidate.value < 10 && credibleMultiDigit) cost += 0.3;
      if (!byValue.has(candidate.value) || cost < byValue.get(candidate.value)) byValue.set(candidate.value, cost);
    }
    return byValue;
  });
  let costs = new Array(101).fill(Infinity);
  costs[100] = 0;
  const backPointers = [];
  for (let index = 0; index < relevant.length; index += 1) {
    const observation = observations[index];
    const bestObservedCost = observation.size ? Math.min(...observation.values()) : 0;
    const nextCosts = new Array(101).fill(Infinity);
    const previousValues = new Int16Array(101).fill(-1);
    for (let value = 0; value <= 100; value += 1) {
      const observedCost = observation.get(value);
      const emission = observation.size
        ? observedCost == null ? 0.7 : Math.max(0, observedCost - bestObservedCost) * 4 + observedCost * 0.08
        : 0;
      for (let previous = value; previous <= 100; previous += 1) {
        const drop = previous - value;
        const transition = drop === 0
          ? 0
          : observedCost != null ? 0.025 + drop * 0.07 : Infinity;
        const cost = costs[previous] + transition + emission;
        if (cost < nextCosts[value]) {
          nextCosts[value] = cost;
          previousValues[value] = previous;
        }
      }
    }
    costs = nextCosts;
    backPointers.push(previousValues);
  }
  let value = costs.indexOf(Math.min(...costs));
  const path = new Array(relevant.length);
  for (let index = relevant.length - 1; index >= 0; index -= 1) {
    const observedCost = observations[index].get(value);
    const previous = backPointers[index][value];
    path[index] = {
      time: relevant[index].time,
      value,
      source: observedCost != null ? 'observed' : previous === value ? 'held' : 'inferred',
      confidence: observedCost != null
        ? Math.max(0.4, Math.min(0.98, 1 - observedCost / 0.5))
        : previous === value ? 0.5 : 0.4,
    };
    value = previous < 0 ? value : previous;
  }
  // A moving objective marker is occasionally unreadable for one or two frames
  // (special-effect flashes and the marker icon can cover a digit). When the
  // surrounding frames are reliable and still show the objective HUD, fill the
  // short monotonic gap instead of freezing the previous count.
  for (let index = 1; index < path.length - 1; index += 1) {
    if (path[index].source !== 'held' || !relevant[index].objectiveVisible) continue;
    const gapStart = index;
    while (index < path.length - 1
      && path[index].source === 'held'
      && relevant[index].objectiveVisible) index += 1;
    const gapEnd = index - 1;
    const previousPoint = path[gapStart - 1];
    const nextPoint = path[index];
    const gapLength = gapEnd - gapStart + 1;
    if (gapLength > 3
      || previousPoint.source !== 'observed'
      || nextPoint.source !== 'observed'
      || nextPoint.value >= previousPoint.value) continue;
    for (let offset = 1; offset <= gapLength; offset += 1) {
      const interpolated = Math.round(previousPoint.value
        + (nextPoint.value - previousPoint.value) * offset / (gapLength + 1));
      path[gapStart + offset - 1] = {
        ...path[gapStart + offset - 1],
        value: interpolated,
        source: 'inferred',
        confidence: 0.62,
      };
    }
  }
  return path;
}

export function stabilizeGameCount(samples, side, { gameplayStart = 10, gameplayEnd = Infinity, rule = null } = {}) {
  if (OBJECTIVE_MARKER_RULES.has(rule)) {
    return stabilizeObjectiveGameCount(samples, side, { gameplayStart, gameplayEnd, rule });
  }
  const relevant = samples.filter(sample => sample.time >= gameplayStart && sample.time <= gameplayEnd);
  if (!relevant.length) return [];
  const observations = relevant.map(sample => {
    const byValue = new Map();
    for (const candidate of sample[side] || []) {
      const adjustedCost = candidate.cost - Math.min(0.06, Math.max(0, (candidate.support || 1) - 1) * 0.012);
      const observation = { cost: adjustedCost, glyphs: candidate.glyphs || String(candidate.value).length };
      if (!byValue.has(candidate.value) || adjustedCost < byValue.get(candidate.value).cost) byValue.set(candidate.value, observation);
    }
    return byValue;
  });
  let value = 100;
  let lastChangeTime = -Infinity;
  let lastReliableTime = relevant[0].time;
  const path = [];
  for (let index = 0; index < relevant.length; index += 1) {
    const hasCredibleMultiDigit = [...observations[index].entries()].some(([candidate, observation]) =>
      candidate >= 10 && candidate <= value && observation.cost <= 0.3);
    const candidates = [...observations[index].entries()]
      .filter(([candidate]) => candidate <= value)
      .map(([candidate, observation]) => [candidate, observation.cost
        + (value >= 10 && candidate < 10 && hasCredibleMultiDigit ? 0.2 : 0)])
      .sort((left, right) => left[1] - right[1]);
    const currentObservation = observations[index].get(value);
    const currentCost = currentObservation?.cost;
    const currentVisibilityMargin = OBJECTIVE_MARKER_RULES.has(rule) ? 0.025 : 0.14;
    const currentStillVisible = currentCost != null
      && currentCost <= (candidates[0]?.[1] ?? currentCost) + currentVisibilityMargin;
    let selected = currentStillVisible ? [value, currentCost] : candidates.find(([candidate, cost]) => {
      if (candidate === value) return true;
      const bestCost = candidates[0]?.[1] ?? cost;
      if (cost > bestCost + 0.16) return false;
      const maximumRate = rule === 'エリア' ? 2.25 : rule === 'ヤグラ' ? 2.5 : rule === 'ホコ' ? 6 : null;
      if (maximumRate != null) {
        const elapsed = Math.max(0.5, relevant[index].time - lastReliableTime);
        const maximumDrop = Math.ceil(elapsed * maximumRate) + 1;
        if (value - candidate > maximumDrop) return false;
      }
      const activeScoringRun = relevant[index].time - lastChangeTime <= 2;
      if (value >= 50 && candidate <= 9 && !activeScoringRun) return false;
      const nextBest = observations.slice(index + 1, index + 5)
        .map(future => [...future.entries()].map(([futureValue, observation]) => [futureValue, observation.cost])
          .sort((left, right) => left[1] - right[1])[0])
        .find(Boolean);
      const confirmedSoon = nextBest && nextBest[0] <= candidate && nextBest[1] <= 0.24;
      // Score counts never increase. If a proposed lower value is followed
      // shortly by a credible value above it, the lower reading came from a
      // transient overlay or a partially hidden digit. Reject it before the
      // monotonic timeline makes that OCR error permanent.
      const recoversSoon = observations.slice(index + 1, index + 7).some(future => {
        const best = [...future.entries()].map(([futureValue, observation]) => [futureValue, observation.cost])
          .sort((left, right) => left[1] - right[1])[0];
        return best && best[0] > candidate && best[0] <= value && best[1] <= 0.24;
      });
      const likelyLeadingEleven = candidate === 1 && value >= 10 && value < 20
        && nextBest && nextBest[0] >= 2 && nextBest[0] <= 9;
      if (recoversSoon && !likelyLeadingEleven) return false;
      if (value >= 20 && candidate <= 9) return activeScoringRun && confirmedSoon;
      return confirmedSoon || activeScoringRun;
    });
    if (selected?.[0] === 1 && value >= 10 && value < 20) {
      const nextBest = observations.slice(index + 1, index + 5)
        .map(future => [...future.entries()].map(([futureValue, observation]) => [futureValue, observation.cost])
          .sort((left, right) => left[1] - right[1])[0])
        .find(Boolean);
      if (nextBest && nextBest[0] >= 2 && nextBest[0] <= 9) selected = [11, selected[1]];
    }
    const changed = Boolean(selected && selected[0] < value);
    if (changed) {
      value = selected[0];
      lastChangeTime = relevant[index].time;
    }
    const observedCost = observations[index].get(value)?.cost;
    if (observedCost != null && observedCost <= 0.3) lastReliableTime = relevant[index].time;
    path.push({
      time: relevant[index].time,
      value,
      source: observedCost == null ? (changed ? 'inferred' : 'held') : 'observed',
      confidence: observedCost == null ? (changed ? 0.7 : 0.45) : Math.max(0.35, Math.min(0.98, 1 - Math.max(0, observedCost) / 0.5)),
    });
  }
  return path;
}

export function stabilizePenalty(samples, side, { gameplayStart = 10, gameplayEnd = Infinity } = {}) {
  const relevant = samples.filter(sample => sample.time >= gameplayStart && sample.time <= gameplayEnd);
  if (!relevant.length) return [];
  const countSide = side === 'leftPenalty' ? 'left' : 'right';
  const rawVisible = relevant.map(sample => Boolean(sample[side]?.visible)
    && (sample[side]?.candidates || []).some(candidate => candidate.cost <= 0.24));
  const confirmedVisible = relevant.map((_sample, index) => {
    if (!rawVisible[index]) {
      const visibleBefore = rawVisible.slice(Math.max(0, index - 4), index).some(Boolean);
      const visibleAfter = rawVisible.slice(index + 1, Math.min(rawVisible.length, index + 5)).some(Boolean);
      return visibleBefore && visibleAfter;
    }
    let neighbors = 0;
    for (let neighbor = Math.max(0, index - 2); neighbor <= Math.min(relevant.length - 1, index + 2); neighbor += 1) {
      if (rawVisible[neighbor]) neighbors += 1;
    }
    return neighbors >= 2;
  });
  let costs = new Array(100).fill(Infinity);
  costs[0] = 0;
  const backPointers = [];
  const observations = [];
  for (let sampleIndex = 0; sampleIndex < relevant.length; sampleIndex += 1) {
    const sample = relevant[sampleIndex];
    const penalty = sample[side] || { visible: false, candidates: [] };
    const recentlyVisible = rawVisible.slice(Math.max(0, sampleIndex - 2), sampleIndex).some(Boolean);
    const kind = rawVisible[sampleIndex] && confirmedVisible[sampleIndex]
      ? 'visible'
      : (confirmedVisible[sampleIndex] || recentlyVisible) ? 'occluded' : (sample[countSide]?.length ? 'absent' : 'hidden');
    const byValue = new Map();
    for (const candidate of penalty.candidates || []) {
      if (candidate.value <= 0 || candidate.value > 99) continue;
      const adjustedCost = candidate.cost - Math.min(0.06, Math.max(0, (candidate.support || 1) - 1) * 0.012);
      if (!byValue.has(candidate.value) || adjustedCost < byValue.get(candidate.value)) byValue.set(candidate.value, adjustedCost);
    }
    const bestObservedCost = byValue.size ? Math.min(...byValue.values()) : 0;
    const nextCosts = new Array(100).fill(Infinity);
    const previousValues = new Int16Array(100).fill(-1);
    for (let value = 0; value <= 99; value += 1) {
      const observedCost = byValue.get(value);
      const emission = kind === 'visible'
        ? (observedCost == null ? (value === 0 ? 1.4 : 0.2) : Math.max(0, observedCost - bestObservedCost) * 3 + observedCost * 0.15)
        : kind === 'absent' ? (value === 0 ? 0 : 0.6) : 0.025;
      for (let previous = 0; previous <= 99; previous += 1) {
        let transition;
        if (previous === value) transition = 0;
        else if (previous === 0) transition = 0.12 + value * 0.001;
        else if (value === 0) transition = kind === 'absent' ? 0.06 : 0.9;
        else if (value < previous) {
          const drop = previous - value;
          transition = drop <= 4 ? 0.16 + drop * 0.02 : 0.45 + drop * 0.004;
        } else transition = 0.4 + (value - previous) * 0.004;
        if ((kind === 'hidden' || kind === 'occluded') && previous !== value) transition += 0.4;
        const cost = costs[previous] + transition + emission;
        if (cost < nextCosts[value]) {
          nextCosts[value] = cost;
          previousValues[value] = previous;
        }
      }
    }
    costs = nextCosts;
    backPointers.push(previousValues);
    observations.push({ kind, byValue });
  }
  let value = costs.indexOf(Math.min(...costs));
  const path = new Array(relevant.length);
  for (let index = relevant.length - 1; index >= 0; index -= 1) {
    const { kind, byValue } = observations[index];
    const observedCost = byValue.get(value);
    const previous = backPointers[index][value];
    const directlyAbsent = kind === 'absent' && value === 0;
    path[index] = {
      time: relevant[index].time,
      value,
      source: observedCost != null || directlyAbsent ? 'observed' : (previous === value ? 'held' : 'inferred'),
      confidence: observedCost != null
        ? Math.max(0.35, Math.min(0.98, 1 - observedCost / 0.5))
        : directlyAbsent ? 0.9 : (previous === value ? 0.45 : 0.35),
    };
    value = previous < 0 ? value : previous;
  }
  // Starting a new penalty from zero needs two consecutive readable frames.
  // This prevents a weak transition artifact from starting a penalty early.
  for (let start = 0; start < path.length; start += 1) {
    if (path[start].value <= 0 || (start > 0 && path[start - 1].value > 0)) continue;
    if (start === 0 && rawVisible[start]) continue;
    let confirmed = start;
    while (confirmed < path.length && path[confirmed].value > 0
      && !(rawVisible[confirmed] && confirmed > 0 && rawVisible[confirmed - 1])) confirmed += 1;
    for (let index = start; index < confirmed; index += 1) path[index] = {
      ...path[index],
      value: 0,
      source: 'held',
      confidence: Math.min(path[index].confidence, 0.45),
    };
    start = Math.max(start, confirmed - 1);
  }
  // A real penalty increase starts at the first frame where the new value is
  // observed. Viterbi can otherwise pull a later sustained value backward over
  // an earlier, equally sustained value.
  for (let index = 1; index < path.length; index += 1) {
    const bestAt = at => [...observations[at].byValue.entries()].sort((left, right) => left[1] - right[1])[0];
    const current = bestAt(index);
    if (!current || current[1] > 0.12) continue;
    const sustained = [index + 1, index + 2].some(at => at < observations.length
      && observations[at].byValue.get(current[0]) <= 0.12);
    if (!sustained) continue;
    let previousIndex = index - 1;
    while (previousIndex >= 0 && !bestAt(previousIndex)) previousIndex -= 1;
    const previous = previousIndex >= 0 ? bestAt(previousIndex) : null;
    if (!previous || previous[0] <= 0 || current[0] <= previous[0]) continue;
    const previousValue = previous[0];
    const previousSupport = observations.slice(Math.max(0, previousIndex - 3), previousIndex + 1)
      .filter(observation => observation.byValue.get(previousValue) <= 0.12).length;
    if (previousSupport < 2) continue;
    let start = previousIndex;
    while (start > 0 && observations[start - 1].byValue.has(previousValue)) start -= 1;
    for (let back = start; back < index; back += 1) {
      const observedCost = observations[back].byValue.get(previousValue);
      path[back] = {
        ...path[back],
        value: previousValue,
        source: observedCost == null ? 'held' : 'observed',
        confidence: observedCost == null ? 0.45 : Math.max(0.35, Math.min(0.98, 1 - observedCost / 0.5)),
      };
    }
  }
  // A hidden HUD can make a stable penalty disappear for a few seconds, and
  // one bad OCR frame can create a short 22 -> 23 -> 22 spike. If the same
  // positive value surrounds the excursion, join it without affecting a
  // sustained transition to a genuinely different value.
  for (let start = 1; start < path.length - 1; start += 1) {
    if (path[start - 1].value <= 0 || path[start].value === path[start - 1].value) continue;
    let end = start;
    while (end + 1 < path.length && path[end + 1].value === path[start].value) end += 1;
    const before = path[start - 1].value;
    const after = path[end + 1]?.value;
    const gapDuration = relevant[end].time - relevant[start].time;
    const maximumDuration = path[start].value === 0 ? 4 : 1.5;
    if (after === before && gapDuration <= maximumDuration) {
      for (let index = start; index <= end; index += 1) path[index] = {
        ...path[index],
        value: before,
        source: 'held',
        confidence: Math.min(path[index].confidence, 0.45),
      };
    }
    start = end;
  }
  // The same OCR error can pass through several values (38 -> 36 -> 33 ->
  // 38). Join any short multi-step excursion surrounded by the same positive
  // value, while leaving sustained transitions such as 17 -> 27 untouched.
  for (let left = 0; left < path.length - 2; left += 1) {
    const stableValue = path[left].value;
    if (stableValue <= 0 || path[left + 1].value === stableValue) continue;
    let right = left + 2;
    while (right < path.length && relevant[right].time - relevant[left].time <= 5 && path[right].value !== stableValue) right += 1;
    if (right >= path.length || path[right].value !== stableValue) continue;
    for (let index = left + 1; index < right; index += 1) path[index] = {
      ...path[index],
      value: stableValue,
      source: 'held',
      confidence: Math.min(path[index].confidence, 0.45),
    };
    left = right - 1;
  }
  return path;
}

export function detectGameCounts(samples, options = {}) {
  // Validate each panel independently: a bright scoring animation can obscure
  // one side while the other side still contains a real instant count change.
  // A lone zero is treated as hidden because fading "100" digits commonly leave
  // only the final zero visible for one frame just before Finish.
  const hiddenTimes = options.hiddenTimes || [];
  const hiddenAt = time => hiddenTimes.some(hiddenTime => Math.abs(hiddenTime - time) <= 0.75);
  const sanitizedSamples = samples.map(sample => hiddenAt(sample.time) ? {
    ...sample,
    left: [],
    right: [],
    leftPenalty: { visible: false, candidates: [] },
    rightPenalty: { visible: false, candidates: [] },
  } : OBJECTIVE_MARKER_RULES.has(options.rule) ? (() => {
    const deconflicted = deconflictObjectiveCandidates(sample.left || [], sample.right || []);
    return {
      ...sample,
      ...deconflicted,
    };
  })() : sample);
  const countSamples = sanitizedSamples.map(sample => {
    const result = { ...sample };
    const independentPanels = OBJECTIVE_MARKER_RULES.has(options.rule);
    const panelVisible = Object.fromEntries(['left', 'right'].map(side => [side, (sample[side] || [])
      .some(candidate => candidate.threshold === 'white' && candidate.cost <= 0.24
        || candidate.cost <= 0.08
        || candidate.cost <= 0.18
        || (candidate.cost <= 0.24 && (candidate.support || 1) >= 2))]));
    for (const side of ['left', 'right']) {
      const candidates = sample[side] || [];
      const best = candidates[0];
      const isolatedZero = best?.value === 0
        && !candidates.some(candidate => candidate.value > 1 && candidate.cost <= best.cost + 0.12);
      const otherSide = side === 'left' ? 'right' : 'left';
      if (!panelVisible[side] || (!independentPanels && !panelVisible[otherSide]) || isolatedZero) result[side] = [];
    }
    return result;
  });
  const bothAtHundred = sample => ['left', 'right'].every(side => (sample[side] || [])
    .some(candidate => candidate.value === 100 && candidate.cost <= 0.24));
  const startIndex = countSamples.findIndex((sample, index) => bothAtHundred(sample)
    && countSamples.slice(index + 1, index + 5).some(bothAtHundred));
  const detectedStart = startIndex >= 0 ? countSamples[startIndex].time : (options.gameplayStart ?? 10);
  const countOptions = { ...options, gameplayStart: Math.max(options.gameplayStart ?? 10, detectedStart) };
  const team = stabilizeGameCount(countSamples, 'left', countOptions);
  const enemy = stabilizeGameCount(countSamples, 'right', countOptions);
  const hasPenalty = ruleHasVisiblePenalty(options.rule);
  const teamPenalty = hasPenalty ? stabilizePenalty(sanitizedSamples, 'leftPenalty', countOptions) : [];
  const enemyPenalty = hasPenalty ? stabilizePenalty(sanitizedSamples, 'rightPenalty', countOptions) : [];
  const enemyByTime = new Map(enemy.map(item => [item.time, item]));
  const teamPenaltyByTime = new Map(teamPenalty.map(item => [item.time, item]));
  const enemyPenaltyByTime = new Map(enemyPenalty.map(item => [item.time, item]));
  return team.map(item => {
    const other = enemyByTime.get(item.time);
    const ownPenalty = teamPenaltyByTime.get(item.time);
    const otherPenalty = enemyPenaltyByTime.get(item.time);
    return {
      time: item.time,
      teamCount: item.value,
      enemyCount: other?.value ?? 100,
      teamPenalty: ownPenalty?.value ?? 0,
      enemyPenalty: otherPenalty?.value ?? 0,
      teamSource: item.source,
      enemySource: other?.source ?? 'held',
      teamPenaltySource: ownPenalty?.source ?? 'held',
      enemyPenaltySource: otherPenalty?.source ?? 'held',
      confidence: Math.min(item.confidence, other?.confidence ?? 0.35),
    };
  });
}
