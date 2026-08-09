function rgbAt(frame, width, x, y) {
  const at = (y * width + x) * 3;
  return [frame[at], frame[at + 1], frame[at + 2]];
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function isCursorPink(frame, width, x, y) {
  const [r, g, b] = rgbAt(frame, width, x, y);
  return r >= 165 && b >= 125 && r >= g + 28 && b >= g + 12 && Math.abs(r - b) <= 100;
}

const ringOffsets = [];
const innerOffsets = [];
for (let y = -14; y <= 14; y += 2) {
  for (let x = -14; x <= 14; x += 2) {
    const distance = Math.hypot(x, y);
    if (distance >= 8 && distance <= 13) ringOffsets.push([x, y]);
    else if (distance <= 6) innerOffsets.push([x, y]);
  }
}

export function detectMapCursor(frame, width, height) {
  let best = null;
  const left = Math.round(width * 0.26);
  const right = Math.round(width * 0.74);
  const top = Math.round(height * 0.16);
  const bottom = Math.round(height * 0.88);
  for (let y = top; y < bottom; y += 3) {
    for (let x = left; x < right; x += 3) {
      let ringHits = 0;
      let innerHits = 0;
      for (const [offsetX, offsetY] of ringOffsets) {
        if (isCursorPink(frame, width, x + offsetX, y + offsetY)) ringHits += 1;
      }
      for (const [offsetX, offsetY] of innerOffsets) {
        if (isCursorPink(frame, width, x + offsetX, y + offsetY)) innerHits += 1;
      }
      const ringRatio = ringHits / ringOffsets.length;
      const innerRatio = innerHits / innerOffsets.length;
      const score = ringRatio - innerRatio * 0.7;
      if (!best || score > best.score) best = { x, y, score, ringRatio, innerRatio };
    }
  }
  if (!best || best.score < 0.4 || best.ringRatio < 0.42) return null;
  const viewportLeft = width * (440 / 1920);
  const viewportTop = height * (20 / 1080);
  const viewportSize = width * (1040 / 1920);
  return {
    screenX: best.x,
    screenY: best.y,
    x: Number((clamp((best.x - viewportLeft) / viewportSize, 0, 1) * 1000).toFixed(1)),
    y: Number((clamp((best.y - viewportTop) / viewportSize, 0, 1) * 1000).toFixed(1)),
    confidence: Number(clamp(0.42 + (best.score - 0.4) * 1.9, 0.42, 0.94).toFixed(3)),
    score: Number(best.score.toFixed(4)),
  };
}

function analyzeMapUiPanel(frame, width, height) {
  const left = Math.round(width * (750 / 960));
  const right = Math.round(width * (940 / 960));
  const top = Math.round(height * (20 / 540));
  const bottom = Math.round(height * (180 / 540));
  let dark = 0;
  let edges = 0;
  let pixels = 0;
  for (let y = top; y < bottom; y += 2) {
    for (let x = left; x < right; x += 2) {
      const [r, g, b] = rgbAt(frame, width, x, y);
      if (Math.max(r, g, b) < 55) dark += 1;
      if (x > left + 1) {
        const [previousR, previousG, previousB] = rgbAt(frame, width, x - 2, y);
        if (Math.abs(r - previousR) + Math.abs(g - previousG) + Math.abs(b - previousB) > 120) edges += 1;
      }
      pixels += 1;
    }
  }
  const darkRatio = dark / Math.max(1, pixels);
  const edgeRatio = edges / Math.max(1, pixels);
  const sidePanel = (startX, endX) => {
    let sideDark = 0;
    let sideEdges = 0;
    let sidePixels = 0;
    const sideTop = Math.round(height * (150 / 540));
    const sideBottom = Math.round(height * (360 / 540));
    for (let y = sideTop; y < sideBottom; y += 2) {
      for (let x = startX; x < endX; x += 2) {
        const [r, g, b] = rgbAt(frame, width, x, y);
        if (Math.max(r, g, b) < 60) sideDark += 1;
        if (x > startX + 1) {
          const [previousR, previousG, previousB] = rgbAt(frame, width, x - 2, y);
          if (Math.abs(r - previousR) + Math.abs(g - previousG) + Math.abs(b - previousB) > 120) sideEdges += 1;
        }
        sidePixels += 1;
      }
    }
    return { darkRatio: sideDark / sidePixels, edgeRatio: sideEdges / sidePixels };
  };
  const leftPanel = sidePanel(0, Math.round(width * (250 / 960)));
  const rightPanel = sidePanel(Math.round(width * (710 / 960)), width);
  const sidePanelsVisible = Math.max(leftPanel.darkRatio, rightPanel.darkRatio) >= 0.12
    && leftPanel.edgeRatio >= 0.028 && rightPanel.edgeRatio >= 0.028;
  return {
    darkRatio: Number(darkRatio.toFixed(4)),
    edgeRatio: Number(edgeRatio.toFixed(4)),
    leftPanel: { darkRatio: Number(leftPanel.darkRatio.toFixed(4)), edgeRatio: Number(leftPanel.edgeRatio.toFixed(4)) },
    rightPanel: { darkRatio: Number(rightPanel.darkRatio.toFixed(4)), edgeRatio: Number(rightPanel.edgeRatio.toFixed(4)) },
    visible: darkRatio >= 0.25 && edgeRatio >= 0.115 && sidePanelsVisible,
  };
}

export function analyzeMapCandidate(frame, width, height, time) {
  const left = Math.round(width * 0.25);
  const right = Math.round(width * 0.75);
  const top = Math.round(height * 0.04);
  const bottom = Math.round(height * 0.96);
  let neutral = 0;
  let edges = 0;
  let pixels = 0;
  for (let y = top; y < bottom; y += 2) {
    for (let x = left; x < right; x += 2) {
      const [r, g, b] = rgbAt(frame, width, x, y);
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const saturation = max ? (max - min) / max : 0;
      if (saturation <= 0.22 && max >= 55 && max <= 242) neutral += 1;
      if (x > left + 2) {
        const [previousR, previousG, previousB] = rgbAt(frame, width, x - 2, y);
        const difference = Math.abs(r - previousR) + Math.abs(g - previousG) + Math.abs(b - previousB);
        if (difference >= 90) edges += 1;
      }
      pixels += 1;
    }
  }
  const neutralRatio = neutral / Math.max(1, pixels);
  const edgeRatio = edges / Math.max(1, pixels);
  const mapUi = analyzeMapUiPanel(frame, width, height);
  const candidate = {
    time,
    neutralRatio: Number(neutralRatio.toFixed(4)),
    edgeRatio: Number(edgeRatio.toFixed(4)),
    score: Number((neutralRatio * 0.82 + edgeRatio * 0.18).toFixed(4)),
    mapUi,
  };
  if (mapUi.visible && candidate.neutralRatio >= 0.36 && candidate.score >= 0.32) candidate.cursor = detectMapCursor(frame, width, height);
  return candidate;
}

export function selectObservedMapFrame(samples, deaths = []) {
  const mapScreens = samples.some(sample => sample.mapUi?.visible) ? samples.filter(sample => sample.mapUi?.visible) : samples;
  const deathWindows = mapScreens.filter(sample => deaths.some(death => sample.time >= death.time + 0.5 && sample.time <= death.time + 5));
  const candidates = deathWindows.length ? deathWindows : mapScreens;
  const best = [...candidates].sort((left, right) => right.score - left.score)[0];
  if (!best || best.neutralRatio < 0.21) return null;
  return {
    ...best,
    confidence: Number(Math.min(0.96, Math.max(0.35, (best.neutralRatio - 0.16) * 3.4)).toFixed(3)),
    source: 'observed-map-screen',
  };
}

export function detectSpatialObservations(samples) {
  const runs = [];
  for (const sample of samples.filter(item => item.mapUi?.visible)) {
    const current = runs.at(-1);
    if (!current || sample.time - current.at(-1).time > 2.1) runs.push([sample]);
    else current.push(sample);
  }
  return runs.flatMap(run => {
    const peakNeutral = Math.max(...run.map(sample => sample.neutralRatio));
    if (peakNeutral < 0.38) return [];
    const initial = run.find(sample => sample.neutralRatio >= Math.max(0.36, peakNeutral - 0.05)
      && sample.score >= 0.32 && sample.cursor?.confidence >= 0.42);
    if (!initial) return [];
    const confidence = Math.min(0.82, initial.cursor.confidence * 0.75 + Math.min(0.18, run.length * 0.04));
    return {
      id: '',
      time: initial.time,
      x: initial.cursor.x,
      y: initial.cursor.y,
      team: 'self',
      source: 'observed-map-cursor',
      confidence: Number(confidence.toFixed(3)),
      evidence: {
        mapScore: initial.score,
        cursorScore: initial.cursor.score,
        screen: { x: initial.cursor.screenX, y: initial.cursor.screenY },
        observedUntil: run.at(-1).time,
      },
    };
  }).map((observation, index) => ({ ...observation, id: `self-map-${index + 1}` }));
}

export function buildPlayerRoute(observations) {
  if (!observations.length) return [];
  const route = [];
  for (let index = 0; index < observations.length; index += 1) {
    const current = observations[index];
    route.push({ time: current.time, x: current.x, y: current.y, source: 'observed', confidence: current.confidence });
    const next = observations[index + 1];
    if (!next) continue;
    const gap = next.time - current.time;
    for (let time = Math.ceil(current.time + 1); time < next.time; time += 1) {
      const ratio = (time - current.time) / gap;
      const nearestDistance = Math.min(time - current.time, next.time - time);
      route.push({
        time,
        x: Number((current.x + (next.x - current.x) * ratio).toFixed(1)),
        y: Number((current.y + (next.y - current.y) * ratio).toFixed(1)),
        source: 'inferred-between-observations',
        confidence: Number(Math.max(0.12, Math.min(current.confidence, next.confidence) * Math.exp(-nearestDistance / 18)).toFixed(3)),
      });
    }
  }
  return route.sort((left, right) => left.time - right.time);
}

export function buildShortPredictions(observations, { seconds = 6 } = {}) {
  const predictions = [];
  for (let index = 1; index < observations.length; index += 1) {
    const previous = observations[index - 1];
    const current = observations[index];
    const elapsed = current.time - previous.time;
    if (elapsed <= 0 || elapsed > 90) continue;
    const velocityX = (current.x - previous.x) / elapsed;
    const velocityY = (current.y - previous.y) / elapsed;
    const distancePerSecond = Math.hypot(velocityX, velocityY);
    if (distancePerSecond < 0.4 || distancePerSecond > 18) continue;
    const frames = [{ time: current.time, x: current.x, y: current.y, confidence: current.confidence }];
    for (let offset = 1; offset <= seconds; offset += 1) {
      frames.push({
        time: current.time + offset,
        x: Number(clamp(current.x + velocityX * offset, 0, 1000).toFixed(1)),
        y: Number(clamp(current.y + velocityY * offset, 0, 1000).toFixed(1)),
        confidence: Number((current.confidence * Math.exp(-offset / 4)).toFixed(3)),
      });
    }
    predictions.push({
      id: `self-prediction-${index}`,
      team: 'self',
      observedAt: current.time,
      expiresAt: current.time + seconds,
      source: 'predicted-from-observed-motion',
      frames,
    });
  }
  return predictions;
}
