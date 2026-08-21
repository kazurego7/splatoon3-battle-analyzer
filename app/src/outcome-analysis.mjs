import { sampleRgbWindow } from './ffmpeg.mjs';

export const outcomeModelVersion = 1;

const REFERENCE_WIDTH = 960;
const REFERENCE_HEIGHT = 540;

function scaled(value, actual, reference) {
  return Math.round(value * actual / reference);
}

function pixelLuma(frame, at) {
  return frame[at] * 0.299 + frame[at + 1] * 0.587 + frame[at + 2] * 0.114;
}

function titleMask(frame, width, height) {
  const left = scaled(14, width, REFERENCE_WIDTH);
  const top = scaled(12, height, REFERENCE_HEIGHT);
  const right = scaled(235, width, REFERENCE_WIDTH);
  const bottom = scaled(88, height, REFERENCE_HEIGHT);
  const maskWidth = right - left;
  const maskHeight = bottom - top;
  const mask = new Uint8Array(maskWidth * maskHeight);
  let dark = 0;
  let white = 0;

  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const sourceAt = (y * width + x) * 3;
      const targetAt = (y - top) * maskWidth + x - left;
      const red = frame[sourceAt];
      const green = frame[sourceAt + 1];
      const blue = frame[sourceAt + 2];
      const luma = pixelLuma(frame, sourceAt);
      if (luma < 62) dark += 1;
      if (luma >= 190 && Math.max(red, green, blue) - Math.min(red, green, blue) <= 55) {
        mask[targetAt] = 1;
        white += 1;
      }
    }
  }

  const total = mask.length;
  return {
    left,
    top,
    width: maskWidth,
    height: maskHeight,
    mask,
    darkRatio: dark / total,
    whiteRatio: white / total,
  };
}

function componentsOf(binary) {
  const { mask, width, height } = binary;
  const visited = new Uint8Array(mask.length);
  const components = [];
  const neighbours = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue;
    const queue = [start];
    visited[start] = 1;
    let head = 0;
    let area = 0;
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    const pixels = [];
    while (head < queue.length) {
      const at = queue[head++];
      const x = at % width;
      const y = Math.floor(at / width);
      area += 1;
      pixels.push([x, y]);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      for (const [dx, dy] of neighbours) {
        const nextX = x + dx;
        const nextY = y + dy;
        if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
        const next = nextY * width + nextX;
        if (!mask[next] || visited[next]) continue;
        visited[next] = 1;
        queue.push(next);
      }
    }
    components.push({ area, minX, maxX, minY, maxY, pixels });
  }
  return components;
}

function glyphMetrics(component) {
  const width = component.maxX - component.minX + 1;
  const height = component.maxY - component.minY + 1;
  const rightStart = component.minX + width * 0.62;
  const upperEnd = component.minY + height * 0.65;
  let upperRight = 0;
  for (const [x, y] of component.pixels) {
    if (x >= rightStart && y <= upperEnd) upperRight += 1;
  }
  const upperRightArea = Math.max(1, (component.maxX - Math.ceil(rightStart) + 1) * (Math.floor(upperEnd) - component.minY + 1));
  return {
    width,
    height,
    aspect: width / height,
    upperRightFill: upperRight / upperRightArea,
    fill: component.area / (width * height),
  };
}

export function inspectOutcomeFrame(frame, width = REFERENCE_WIDTH, height = REFERENCE_HEIGHT) {
  const binary = titleMask(frame, width, height);
  const minArea = Math.max(24, scaled(70, width * height, REFERENCE_WIDTH * REFERENCE_HEIGHT));
  const minHeight = scaled(19, height, REFERENCE_HEIGHT);
  return {
    darkRatio: Number(binary.darkRatio.toFixed(3)),
    whiteRatio: Number(binary.whiteRatio.toFixed(3)),
    components: componentsOf(binary)
      .filter(component => component.area >= minArea && component.maxY - component.minY + 1 >= minHeight)
      .sort((left, right) => left.minX - right.minX)
      .map(component => ({
        x: component.minX + binary.left,
        y: component.minY + binary.top,
        area: component.area,
        ...Object.fromEntries(Object.entries(glyphMetrics(component)).map(([key, value]) => [key, Number(value.toFixed(3))])),
      })),
  };
}

export function analyzeOutcomeFrame(frame, width = REFERENCE_WIDTH, height = REFERENCE_HEIGHT, time = null) {
  if (!frame || frame.length < width * height * 3) return null;
  const binary = titleMask(frame, width, height);
  if (binary.darkRatio < 0.42 || binary.whiteRatio < 0.025 || binary.whiteRatio > 0.32) return null;

  const minArea = Math.max(24, scaled(70, width * height, REFERENCE_WIDTH * REFERENCE_HEIGHT));
  const minHeight = scaled(19, height, REFERENCE_HEIGHT);
  const titleComponents = componentsOf(binary)
    .filter(component => component.area >= minArea && component.maxY - component.minY + 1 >= minHeight)
    .sort((left, right) => left.minX - right.minX);
  if (titleComponents.length < 3) return null;

  const first = titleComponents.find(component => {
    const absoluteX = component.minX + binary.left;
    const absoluteY = component.minY + binary.top;
    return absoluteX >= scaled(18, width, REFERENCE_WIDTH)
      && absoluteX <= scaled(75, width, REFERENCE_WIDTH)
      && absoluteY >= scaled(16, height, REFERENCE_HEIGHT)
      && absoluteY <= scaled(52, height, REFERENCE_HEIGHT);
  });
  if (!first) return null;
  const glyph = glyphMetrics(first);

  let value = null;
  let shapeConfidence = 0;
  if (glyph.aspect >= 0.88 && glyph.upperRightFill >= 0.12) {
    value = 'win';
    shapeConfidence = Math.min(1, (glyph.aspect - 0.72) * 1.6 + (glyph.upperRightFill - 0.06) * 2.4);
  } else if (glyph.aspect <= 0.72 && glyph.upperRightFill <= 0.36) {
    value = 'lose';
    shapeConfidence = Math.min(1, (0.9 - glyph.aspect) * 1.7 + (0.4 - glyph.upperRightFill) * 1.2);
  }
  if (!value || shapeConfidence < 0.35) return null;

  return {
    value,
    time,
    confidence: Number(Math.min(0.99, 0.55 + shapeConfidence * 0.32 + Math.min(0.12, (binary.darkRatio - 0.42) * 0.3)).toFixed(3)),
    evidence: '試合終了後の左上に表示されるWIN/LOSE発表をローカル画像処理で検出',
    metrics: {
      darkRatio: Number(binary.darkRatio.toFixed(3)),
      whiteRatio: Number(binary.whiteRatio.toFixed(3)),
      titleComponents: titleComponents.length,
      firstGlyphAspect: Number(glyph.aspect.toFixed(3)),
      firstGlyphUpperRightFill: Number(glyph.upperRightFill.toFixed(3)),
    },
  };
}

export function consolidateOutcomeObservations(observations, { minimumAgreement = 2 } = {}) {
  const detected = observations.filter(Boolean);
  if (!detected.length) return null;
  const groups = new Map();
  for (const observation of detected) {
    const group = groups.get(observation.value) || [];
    group.push(observation);
    groups.set(observation.value, group);
  }
  const ranked = [...groups.entries()].sort((left, right) => right[1].length - left[1].length);
  const [value, winners] = ranked[0];
  const opposition = ranked[1]?.[1].length || 0;
  if (winners.length < minimumAgreement || winners.length < opposition + 2) return null;
  const confidence = winners.reduce((sum, item) => sum + item.confidence, 0) / winners.length;
  const representative = [...winners].sort((left, right) => right.confidence - left.confidence)[0];
  return {
    value,
    label: value === 'win' ? 'WIN' : 'LOSE',
    time: representative.time,
    confidence: Number(Math.min(0.99, confidence + Math.min(0.08, (winners.length - minimumAgreement) * 0.015)).toFixed(3)),
    observations: winners.length,
    evidence: representative.evidence,
    source: 'post-match-announcement-local-vision',
  };
}

export async function analyzeOutcomeLocally({ source, matchStart, activeEnd, matchEnd, sampler = sampleRgbWindow }) {
  const anchor = Math.min(activeEnd, matchEnd);
  const scanStart = Math.max(matchStart, anchor - 35);
  let scanEnd = Math.min(matchEnd, Math.max(scanStart + 1, anchor + 8));
  let samples = await sampler(source, scanStart, scanEnd, {
    interval: 1,
    onFrame: (frame, width, height, time) => analyzeOutcomeFrame(frame, width, height, time),
  });
  let outcome = consolidateOutcomeObservations(samples);
  // Some older or low-HUD matches have a coarse activeEnd before the actual
  // announcement. Only pay for a later scan when the primary window missed it.
  if (!outcome && matchEnd - scanEnd >= 2) {
    // Long victory animations can delay the WIN/LOSE title for nearly a
    // minute. This second pass only runs after the cheap primary scan misses,
    // so inspect the remainder of the bounded match instead of cutting off a
    // valid late announcement.
    const fallbackEnd = matchEnd;
    const fallback = await sampler(source, scanEnd, fallbackEnd, {
      interval: 1,
      onFrame: (frame, width, height, time) => analyzeOutcomeFrame(frame, width, height, time),
    });
    samples = [...samples, ...fallback];
    scanEnd = fallbackEnd;
    outcome = consolidateOutcomeObservations(samples);
  }
  if (!outcome) return null;
  return {
    ...outcome,
    time: Number((outcome.time - matchStart).toFixed(2)),
    scan: {
      start: Number((scanStart - matchStart).toFixed(2)),
      end: Number((scanEnd - matchStart).toFixed(2)),
    },
  };
}
