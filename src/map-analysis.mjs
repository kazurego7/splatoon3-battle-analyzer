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
const cursorOuterOffsets = [];
for (let y = -14; y <= 14; y += 2) {
  for (let x = -14; x <= 14; x += 2) {
    const distance = Math.hypot(x, y);
    if (distance >= 8 && distance <= 13) ringOffsets.push([x, y]);
    else if (distance <= 6) innerOffsets.push([x, y]);
  }
}
for (let y = -24; y <= 24; y += 2) {
  for (let x = -24; x <= 24; x += 2) {
    const distance = Math.hypot(x, y);
    if (distance >= 17 && distance <= 23) cursorOuterOffsets.push([x, y]);
  }
}

const allyInnerOffsets = [];
const allyRingOffsets = [];
const allyOuterOffsets = [];
const allyPointerOffsets = [];
for (let y = -30; y <= 30; y += 2) {
  for (let x = -30; x <= 30; x += 2) {
    const distance = Math.hypot(x, y);
    if (distance <= 12) allyInnerOffsets.push([x, y]);
    else if (distance >= 16 && distance <= 22) allyRingOffsets.push([x, y]);
    else if (distance >= 24 && distance <= 30) allyOuterOffsets.push([x, y]);
  }
}
for (let y = -6; y <= 6; y += 2) for (let x = -6; x <= 6; x += 2) allyPointerOffsets.push([x, y]);

function pixelHue(frame, width, x, y) {
  const [r, g, b] = rgbAt(frame, width, x, y);
  const maximum = Math.max(r, g, b);
  const minimum = Math.min(r, g, b);
  const delta = maximum - minimum;
  if (maximum < 65 || delta / maximum < 0.28) return null;
  let hue;
  if (maximum === r) hue = ((g - b) / delta) % 6;
  else if (maximum === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  return ((hue * 60) % 360 + 360) % 360;
}

function hueDistance(left, right) {
  const distance = Math.abs(left - right);
  return Math.min(distance, 360 - distance);
}

function isTeamColor(frame, width, x, y, teamHue) {
  const hue = pixelHue(frame, width, x, y);
  return hue != null && hueDistance(hue, teamHue) <= 45;
}

export function estimateMapTeamColor(frame, width, height) {
  const bins = Array(24).fill(0);
  const hues = [];
  const right = Math.round(width * 0.27);
  const top = Math.round(height * 0.82);
  for (let y = top; y < height; y += 1) {
    for (let x = 0; x < right; x += 1) {
      const hue = pixelHue(frame, width, x, y);
      if (hue == null) continue;
      bins[Math.floor(hue / 15) % bins.length] += 1;
      hues.push(hue);
    }
  }
  if (hues.length < 80) return null;
  const scores = bins.map((count, index) => count
    + bins[(index + bins.length - 1) % bins.length]
    + bins[(index + 1) % bins.length]);
  const peakIndex = scores.indexOf(Math.max(...scores));
  const peakHue = peakIndex * 15 + 7.5;
  const selected = hues.filter(hue => hueDistance(hue, peakHue) <= 30);
  if (selected.length < 80) return null;
  const cosine = selected.reduce((sum, hue) => sum + Math.cos(hue * Math.PI / 180), 0);
  const sine = selected.reduce((sum, hue) => sum + Math.sin(hue * Math.PI / 180), 0);
  const hue = (Math.atan2(sine, cosine) * 180 / Math.PI + 360) % 360;
  return {
    hue: Number(hue.toFixed(1)),
    confidence: Number(clamp(selected.length / hues.length, 0, 1).toFixed(3)),
    sampleCount: selected.length,
    source: 'bottom-left-self-panel-color',
  };
}

function isMarkerWhite(frame, width, x, y) {
  const [r, g, b] = rgbAt(frame, width, x, y);
  const maximum = Math.max(r, g, b);
  const minimum = Math.min(r, g, b);
  return minimum > 145 && maximum - minimum < 75;
}

export function analyzeMapCloseButton(frame, width, height) {
  const scaleX = width / 960;
  const scaleY = height / 540;
  const left = Math.round(20 * scaleX);
  const right = Math.round(86 * scaleX);
  const top = Math.round(20 * scaleY);
  const bottom = Math.round(82 * scaleY);
  const regionWidth = right - left;
  const regionHeight = bottom - top;
  const mask = new Uint8Array(regionWidth * regionHeight);
  for (let y = 0; y < regionHeight; y += 1) {
    for (let x = 0; x < regionWidth; x += 1) {
      const [r, g, b] = rgbAt(frame, width, left + x, top + y);
      const maximum = Math.max(r, g, b);
      const minimum = Math.min(r, g, b);
      if (minimum > 135 && maximum - minimum < 90) mask[y * regionWidth + x] = 1;
    }
  }
  const visited = new Uint8Array(mask.length);
  const components = [];
  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index] || visited[index]) continue;
    const queue = [index];
    visited[index] = 1;
    let area = 0;
    let minimumX = regionWidth;
    let maximumX = 0;
    let minimumY = regionHeight;
    let maximumY = 0;
    for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
      const current = queue[queueIndex];
      const x = current % regionWidth;
      const y = Math.floor(current / regionWidth);
      area += 1;
      minimumX = Math.min(minimumX, x);
      maximumX = Math.max(maximumX, x);
      minimumY = Math.min(minimumY, y);
      maximumY = Math.max(maximumY, y);
      for (const [offsetX, offsetY] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nextX = x + offsetX;
        const nextY = y + offsetY;
        if (nextX < 0 || nextX >= regionWidth || nextY < 0 || nextY >= regionHeight) continue;
        const next = nextY * regionWidth + nextX;
        if (mask[next] && !visited[next]) {
          visited[next] = 1;
          queue.push(next);
        }
      }
    }
    components.push({
      area,
      x: left + minimumX,
      y: top + minimumY,
      width: maximumX - minimumX + 1,
      height: maximumY - minimumY + 1,
    });
  }
  const expectedX = 55 * scaleX;
  const expectedY = 49 * scaleY;
  const match = components
    .filter(component => component.area >= 180 * scaleX * scaleY
      && component.width >= 20 * scaleX && component.width <= 34 * scaleX
      && component.height >= 20 * scaleY && component.height <= 34 * scaleY)
    .map(component => ({
      ...component,
      centerX: component.x + component.width / 2,
      centerY: component.y + component.height / 2,
    }))
    .sort((leftComponent, rightComponent) => Math.hypot(leftComponent.centerX - expectedX, leftComponent.centerY - expectedY)
      - Math.hypot(rightComponent.centerX - expectedX, rightComponent.centerY - expectedY))[0];
  const positionError = match ? Math.hypot(match.centerX - expectedX, match.centerY - expectedY) : Number.POSITIVE_INFINITY;
  return {
    visible: positionError <= 4 * Math.max(scaleX, scaleY),
    positionError: Number.isFinite(positionError) ? Number(positionError.toFixed(2)) : null,
    component: match || null,
  };
}

function analyzeSelectedPlayerPanel(frame, width, height) {
  const scaleX = width / 960;
  const scaleY = height / 540;
  const panelBorders = {
    top: [[350, 15, 610, 27], [350, 70, 610, 84], [350, 15, 366, 84], [594, 15, 610, 84]],
    left: [[10, 238, 270, 250], [10, 296, 270, 308], [10, 238, 24, 308], [256, 238, 272, 308]],
    right: [[688, 238, 950, 250], [688, 296, 950, 308], [688, 238, 704, 308], [936, 238, 952, 308]],
  };
  const scoreRegion = ([left, top, right, bottom]) => {
    let pink = 0;
    let pixels = 0;
    for (let y = Math.round(top * scaleY); y < Math.round(bottom * scaleY); y += 1) {
      for (let x = Math.round(left * scaleX); x < Math.round(right * scaleX); x += 1) {
        if (isCursorPink(frame, width, x, y)) pink += 1;
        pixels += 1;
      }
    }
    return pink / Math.max(1, pixels);
  };
  const panels = Object.entries(panelBorders).map(([panel, regions]) => {
    const edges = regions.map(scoreRegion);
    return {
      panel,
      score: edges.reduce((sum, value) => sum + value, 0) / edges.length,
      supportingEdges: edges.filter(value => value >= 0.07).length,
      edges: edges.map(value => Number(value.toFixed(3))),
    };
  }).sort((left, right) => right.score - left.score);
  const selected = panels[0];
  return {
    selected: selected.score >= 0.08 && selected.supportingEdges >= 3 ? selected.panel : null,
    confidence: Number(clamp((selected.score - 0.06) * 5, 0, 0.95).toFixed(3)),
    panels: Object.fromEntries(panels.map(panel => [panel.panel, {
      score: Number(panel.score.toFixed(3)),
      supportingEdges: panel.supportingEdges,
    }])),
  };
}

function mapCoordinates(width, height, screenX, screenY) {
  const viewportLeft = width * (440 / 1920);
  const viewportTop = height * (20 / 1080);
  const viewportSize = width * (1040 / 1920);
  return {
    x: Number((clamp((screenX - viewportLeft) / viewportSize, 0, 1) * 1000).toFixed(1)),
    y: Number((clamp((screenY - viewportTop) / viewportSize, 0, 1) * 1000).toFixed(1)),
  };
}

export function detectMapAllies(frame, width, height, teamColor = estimateMapTeamColor(frame, width, height)) {
  if (teamColor?.hue == null) return [];
  const candidates = [];
  const left = Math.round(width * (280 / 960));
  const right = Math.round(width * (680 / 960));
  const top = Math.round(height * (150 / 540));
  const bottom = Math.round(height * (460 / 540));
  for (let y = top; y < bottom; y += 3) {
    for (let x = left; x < right; x += 3) {
      let ringBlue = 0;
      let outerBlue = 0;
      let innerBlue = 0;
      let innerDark = 0;
      let innerWhite = 0;
      for (const [offsetX, offsetY] of allyRingOffsets) {
        if (isTeamColor(frame, width, x + offsetX, y + offsetY, teamColor.hue)) ringBlue += 1;
      }
      const ringRatio = ringBlue / allyRingOffsets.length;
      if (ringRatio < 0.5) continue;
      for (const [offsetX, offsetY] of allyOuterOffsets) {
        if (isTeamColor(frame, width, x + offsetX, y + offsetY, teamColor.hue)) outerBlue += 1;
      }
      const outerRatio = outerBlue / allyOuterOffsets.length;
      const ringContrast = ringRatio - outerRatio;
      if (ringContrast < 0.18) continue;
      for (const [offsetX, offsetY] of allyInnerOffsets) {
        const pixelX = x + offsetX;
        const pixelY = y + offsetY;
        if (isTeamColor(frame, width, pixelX, pixelY, teamColor.hue)) innerBlue += 1;
        if (isMarkerWhite(frame, width, pixelX, pixelY)) innerWhite += 1;
        if (Math.max(...rgbAt(frame, width, pixelX, pixelY)) < 65) innerDark += 1;
      }
      const innerBlueRatio = innerBlue / allyInnerOffsets.length;
      const innerWhiteRatio = innerWhite / allyInnerOffsets.length;
      const innerDarkRatio = innerDark / allyInnerOffsets.length;
      if (innerBlueRatio < 0.42 || innerWhiteRatio > 0.28 || innerDarkRatio < 0.02 || innerDarkRatio > 0.28) continue;

      let pointerRatio = 0;
      let directionDegrees = 0;
      for (let angle = 0; angle < 360; angle += 15) {
        const radians = angle * Math.PI / 180;
        const centerX = x + Math.cos(radians) * 29;
        const centerY = y + Math.sin(radians) * 29;
        let white = 0;
        for (const [offsetX, offsetY] of allyPointerOffsets) {
          if (isMarkerWhite(frame, width, Math.round(centerX + offsetX), Math.round(centerY + offsetY))) white += 1;
        }
        const ratio = white / allyPointerOffsets.length;
        if (ratio > pointerRatio) {
          pointerRatio = ratio;
          directionDegrees = angle;
        }
      }
      if (pointerRatio < 0.25) continue;
      const score = ringContrast * 0.4 + innerBlueRatio * 0.25 + pointerRatio * 0.25 + innerDarkRatio * 0.1;
      candidates.push({
        screenX: x,
        screenY: y,
        ...mapCoordinates(width, height, x, y),
        directionDegrees,
        confidence: Number(clamp(0.38 + score * 0.62, 0.42, 0.9).toFixed(3)),
        evidence: {
          ringContrast: Number(ringContrast.toFixed(3)),
          innerTeamRatio: Number(innerBlueRatio.toFixed(3)),
          innerWhiteRatio: Number(innerWhiteRatio.toFixed(3)),
          pointerRatio: Number(pointerRatio.toFixed(3)),
          teamHue: teamColor.hue,
          teamColorConfidence: teamColor.confidence,
        },
      });
    }
  }
  candidates.sort((leftCandidate, rightCandidate) => rightCandidate.confidence - leftCandidate.confidence);
  const selected = [];
  for (const candidate of candidates) {
    if (selected.every(item => Math.hypot(item.screenX - candidate.screenX, item.screenY - candidate.screenY) > 32)) selected.push(candidate);
  }
  return selected.slice(0, 6);
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
      let outerHits = 0;
      for (const [offsetX, offsetY] of ringOffsets) {
        if (isCursorPink(frame, width, x + offsetX, y + offsetY)) ringHits += 1;
      }
      for (const [offsetX, offsetY] of innerOffsets) {
        if (isCursorPink(frame, width, x + offsetX, y + offsetY)) innerHits += 1;
      }
      const ringRatio = ringHits / ringOffsets.length;
      const innerRatio = innerHits / innerOffsets.length;
      if (ringRatio < 0.35) continue;
      for (const [offsetX, offsetY] of cursorOuterOffsets) {
        if (isCursorPink(frame, width, x + offsetX, y + offsetY)) outerHits += 1;
      }
      const outerRatio = outerHits / cursorOuterOffsets.length;
      const ringContrast = ringRatio - outerRatio;
      if (ringContrast < 0.3) continue;
      const score = ringContrast - innerRatio * 0.7;
      if (!best || score > best.score) best = { x, y, score, ringRatio, innerRatio, outerRatio };
    }
  }
  if (!best || best.score < 0.4 || best.ringRatio < 0.42) return null;
  const position = mapCoordinates(width, height, best.x, best.y);
  return {
    screenX: best.x,
    screenY: best.y,
    ...position,
    confidence: Number(clamp(0.42 + (best.score - 0.4) * 1.9, 0.42, 0.94).toFixed(3)),
    score: Number(best.score.toFixed(4)),
    ringRatio: Number(best.ringRatio.toFixed(4)),
    innerRatio: Number(best.innerRatio.toFixed(4)),
    outerRatio: Number(best.outerRatio.toFixed(4)),
    ringContrast: Number((best.ringRatio - best.outerRatio).toFixed(4)),
  };
}

function analyzeMapUiPanel(frame, width, height) {
  const closeButton = analyzeMapCloseButton(frame, width, height);
  const selectedPlayerPanel = analyzeSelectedPlayerPanel(frame, width, height);
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
    closeButton,
    selectedPlayerPanel,
    visible: closeButton.visible && darkRatio >= 0.25 && edgeRatio >= 0.115 && sidePanelsVisible,
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
  if (mapUi.visible && candidate.neutralRatio >= 0.36 && candidate.score >= 0.32) {
    candidate.teamColor = estimateMapTeamColor(frame, width, height);
    candidate.cursor = detectMapCursor(frame, width, height);
    candidate.allies = detectMapAllies(frame, width, height, candidate.teamColor);
  }
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
    const initial = run
      .filter(sample => sample.neutralRatio >= 0.36 && sample.score >= 0.32 && sample.selfMarker?.confidence >= 0.5)
      .sort((left, right) => right.selfMarker.confidence - left.selfMarker.confidence || left.time - right.time)[0];
    if (!initial) return [];
    const sample = initial;
    return {
      id: '',
      time: sample.time,
      x: sample.selfMarker.x,
      y: sample.selfMarker.y,
      directionDegrees: sample.selfMarker.directionDegrees,
      team: 'self',
      source: 'observed-map-self-marker',
      confidence: sample.selfMarker.confidence,
      evidence: {
        mapScore: sample.score,
        ...sample.selfMarker.evidence,
        screen: { x: sample.selfMarker.screenX, y: sample.selfMarker.screenY },
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
    route.push({ time: current.time, x: current.x, y: current.y, directionDegrees: current.directionDegrees, source: 'observed', confidence: current.confidence });
    const next = observations[index + 1];
    if (!next) continue;
    const gap = next.time - current.time;
    for (let time = Math.ceil(current.time + 1); time < next.time; time += 1) {
      const ratio = (time - current.time) / gap;
      const nearestDistance = Math.min(time - current.time, next.time - time);
      const directionDelta = current.directionDegrees == null || next.directionDegrees == null
        ? null
        : (((next.directionDegrees - current.directionDegrees) % 360) + 540) % 360 - 180;
      route.push({
        time,
        x: Number((current.x + (next.x - current.x) * ratio).toFixed(1)),
        y: Number((current.y + (next.y - current.y) * ratio).toFixed(1)),
        directionDegrees: current.directionDegrees == null || next.directionDegrees == null
          ? null
          : Number(((current.directionDegrees + directionDelta * ratio + 360) % 360).toFixed(1)),
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

function mapRuns(samples) {
  const runs = [];
  for (const sample of samples.filter(item => item.mapUi?.visible)) {
    const current = runs.at(-1);
    if (!current || sample.time - current.at(-1).time > 2.1) runs.push([sample]);
    else current.push(sample);
  }
  return runs;
}

export function detectAllyTracks(samples) {
  const episodes = mapRuns(samples).flatMap(run => {
    const usable = run.filter(sample => sample.neutralRatio >= 0.36
      && ((sample.allies?.length > 0 && sample.allies.length <= 4)
        || (sample.mapUi?.selectedPlayerPanel?.selected && sample.cursor)));
    if (!usable.length) return [];
    const sample = [...usable].sort((left, right) => Math.min(4, right.allies?.length || 0) - Math.min(4, left.allies?.length || 0) || left.time - right.time)[0];
    const markers = (sample.allies?.length <= 4 ? sample.allies : []).map(marker => ({
      time: sample.time,
      x: marker.x,
      y: marker.y,
      directionDegrees: marker.directionDegrees,
      confidence: marker.confidence,
      source: 'observed-map-ally-marker',
      evidence: { ...marker.evidence, screen: { x: marker.screenX, y: marker.screenY }, observedUntil: run.at(-1).time },
    }));
    if (sample.mapUi?.selectedPlayerPanel?.selected && sample.cursor) markers.push({
      time: sample.time,
      x: sample.cursor.x,
      y: sample.cursor.y,
      directionDegrees: null,
      confidence: Number(Math.min(sample.cursor.confidence, sample.mapUi.selectedPlayerPanel.confidence).toFixed(3)),
      source: 'observed-map-selected-ally-cursor',
      evidence: {
        selectedPanel: sample.mapUi.selectedPlayerPanel.selected,
        cursorScore: sample.cursor.score,
        screen: { x: sample.cursor.screenX, y: sample.cursor.screenY },
        observedUntil: run.at(-1).time,
      },
    });
    return markers;
  });

  const stationaryClusters = [];
  for (const observation of episodes) {
    let cluster = stationaryClusters.find(item => Math.hypot(item.x - observation.x, item.y - observation.y) <= 18);
    if (!cluster) {
      cluster = { x: observation.x, y: observation.y, observations: [] };
      stationaryClusters.push(cluster);
    }
    cluster.observations.push(observation);
    cluster.x = cluster.observations.reduce((sum, item) => sum + item.x, 0) / cluster.observations.length;
    cluster.y = cluster.observations.reduce((sum, item) => sum + item.y, 0) / cluster.observations.length;
  }
  const staticIcons = stationaryClusters.filter(cluster => {
    const distinctEpisodes = new Set(cluster.observations.map(item => item.time)).size;
    const averageWhite = cluster.observations.reduce((sum, item) => sum + (item.evidence.innerWhiteRatio ?? 0), 0) / cluster.observations.length;
    return distinctEpisodes >= 3 && averageWhite >= 0.15;
  });
  const observations = episodes.filter(observation => !staticIcons.some(icon => Math.hypot(icon.x - observation.x, icon.y - observation.y) <= 22));

  const tracks = [];
  for (const time of [...new Set(observations.map(item => item.time))].sort((left, right) => left - right)) {
    const atTime = observations.filter(item => item.time === time)
      .sort((left, right) => Number(right.source === 'observed-map-selected-ally-cursor')
        - Number(left.source === 'observed-map-selected-ally-cursor') || right.confidence - left.confidence)
      .slice(0, 3);
    const availableTracks = new Set(tracks.map((_, index) => index));
    for (const observation of atTime) {
      const match = [...availableTracks]
        .map(index => ({ index, distance: Math.hypot(tracks[index].frames.at(-1).x - observation.x, tracks[index].frames.at(-1).y - observation.y) }))
        .filter(item => item.distance <= 280)
        .sort((left, right) => left.distance - right.distance)[0];
      if (match) {
        tracks[match.index].frames.push(observation);
        availableTracks.delete(match.index);
      } else {
        tracks.push({ id: `ally-${tracks.length + 1}`, team: 'ally', identity: 'anonymous-nearest-neighbor', frames: [observation] });
      }
    }
  }
  return tracks;
}

export function buildEntityPredictions(tracks, { seconds = 6, distance = 72 } = {}) {
  const predictions = [];
  for (const track of tracks) {
    for (let index = 0; index < track.frames.length; index += 1) {
      const observation = track.frames[index];
      if (observation.directionDegrees == null) continue;
      const nextObservation = track.frames[index + 1];
      const duration = Math.min(seconds, nextObservation ? Math.max(0, nextObservation.time - observation.time - 0.5) : seconds);
      if (duration < 1) continue;
      const radians = observation.directionDegrees * Math.PI / 180;
      const frames = [];
      for (let offset = 0; offset <= duration; offset += 1) {
        frames.push({
          time: observation.time + offset,
          x: Number(clamp(observation.x + Math.cos(radians) * distance * offset / seconds, 0, 1000).toFixed(1)),
          y: Number(clamp(observation.y + Math.sin(radians) * distance * offset / seconds, 0, 1000).toFixed(1)),
          confidence: Number((observation.confidence * Math.exp(-offset / 3.5)).toFixed(3)),
        });
      }
      predictions.push({
        id: `${track.id}-prediction-${index + 1}`,
        entityId: track.id,
        team: track.team,
        observedAt: observation.time,
        expiresAt: observation.time + duration,
        source: 'predicted-from-map-facing-direction',
        frames,
      });
    }
  }
  return predictions;
}

export function buildEnemyThreatZones(deaths, selfObservations, { seconds = 6, maximumDelay = 10 } = {}) {
  const zones = [];
  for (const death of deaths) {
    const position = selfObservations
      .filter(observation => observation.time >= death.time && observation.time - death.time <= maximumDelay)
      .sort((left, right) => left.time - right.time)[0];
    if (!position) continue;
    const confidence = Number(Math.min(0.48, (death.confidence || 0.5) * position.confidence * 0.72).toFixed(3));
    zones.push({
      id: `enemy-threat-${zones.length + 1}`,
      team: 'enemy',
      type: 'uncertainty-zone',
      observedAt: death.time,
      expiresAt: death.time + seconds,
      x: position.x,
      y: position.y,
      source: 'predicted-near-self-death-location',
      confidence,
      frames: Array.from({ length: seconds + 1 }, (_, offset) => ({
        time: death.time + offset,
        x: position.x,
        y: position.y,
        radius: Number((55 + offset * 11).toFixed(1)),
        confidence: Number((confidence * Math.exp(-offset / 3.5)).toFixed(3)),
      })),
      evidence: {
        deathId: death.id,
        deathTime: death.time,
        positionObservationId: position.id,
        positionObservedAt: position.time,
        positionDelay: Number((position.time - death.time).toFixed(2)),
      },
    });
  }
  return zones;
}

function routeStateAt(route, time) {
  if (!route.length || time < route[0].time || time > route.at(-1).time) return null;
  const rightIndex = route.findIndex(point => point.time >= time);
  const right = route[Math.max(0, rightIndex)];
  const left = route[Math.max(0, rightIndex - 1)] || right;
  const duration = Math.max(0.001, right.time - left.time);
  const ratio = clamp((time - left.time) / duration, 0, 1);
  return {
    x: left.x + (right.x - left.x) * ratio,
    y: left.y + (right.y - left.y) * ratio,
    confidence: Math.min(left.confidence ?? 0.2, right.confidence ?? 0.2),
  };
}

function routeHeadingAt(route, time) {
  const facing = route
    .filter(point => point.source === 'observed' && point.directionDegrees != null && Math.abs(point.time - time) <= 20)
    .sort((left, right) => Math.abs(left.time - time) - Math.abs(right.time - time))[0];
  if (facing) return { radians: facing.directionDegrees * Math.PI / 180, source: 'nearby-observed-map-facing-direction' };
  const nearby = route.filter(point => Math.abs(point.time - time) <= 8);
  if (nearby.length < 2) return null;
  const first = nearby[0];
  const last = nearby.at(-1);
  if (Math.hypot(last.x - first.x, last.y - first.y) < 8) return null;
  return { radians: Math.atan2(last.y - first.y, last.x - first.x), source: 'self-route-motion-direction' };
}

export function buildEnemySightPredictions(detections, playerRoute, { seconds = 4 } = {}) {
  const predictions = [];
  for (const detection of detections.filter(item => item.kind === 'enemy-color-motion-candidate')) {
    const projected = detection.frames.flatMap(frame => {
      const [time, x, _y, width, height] = frame;
      const self = routeStateAt(playerRoute, time);
      const heading = routeHeadingAt(playerRoute, time);
      if (!self || !heading) return [];
      const screenCenterX = x + width / 2;
      const bearingOffset = (screenCenterX - 0.5) * (Math.PI / 2);
      const distance = clamp(22 / Math.max(0.04, height), 55, 210);
      const bearing = heading.radians + bearingOffset;
      return [{
        time,
        x: clamp(self.x + Math.cos(bearing) * distance, 0, 1000),
        y: clamp(self.y + Math.sin(bearing) * distance, 0, 1000),
        confidence: Math.min(0.28, detection.confidence * self.confidence * 0.48),
        headingSource: heading.source,
      }];
    });
    if (!projected.length) continue;
    const anchor = projected.at(-1);
    const previous = projected.length > 1 ? projected.at(-2) : null;
    let velocityX = 0;
    let velocityY = 0;
    if (previous) {
      const elapsed = Math.max(0.5, anchor.time - previous.time);
      velocityX = (anchor.x - previous.x) / elapsed;
      velocityY = (anchor.y - previous.y) / elapsed;
      const speed = Math.hypot(velocityX, velocityY);
      if (speed > 18) {
        velocityX *= 18 / speed;
        velocityY *= 18 / speed;
      }
    }
    const frames = Array.from({ length: seconds + 1 }, (_, offset) => ({
      time: anchor.time + offset,
      x: Number(clamp(anchor.x + velocityX * offset, 0, 1000).toFixed(1)),
      y: Number(clamp(anchor.y + velocityY * offset, 0, 1000).toFixed(1)),
      radius: 85 + offset * 28,
      confidence: Number((anchor.confidence * Math.exp(-offset / 2.4)).toFixed(3)),
    }));
    predictions.push({
      id: `${detection.id}-map-prediction`,
      entityId: detection.id,
      team: 'enemy',
      observedAt: anchor.time,
      expiresAt: anchor.time + seconds,
      source: 'predicted-from-video-candidate-and-self-route-heading',
      frames,
      confidence: Number(anchor.confidence.toFixed(3)),
      evidence: {
        detectionId: detection.id,
        headingSource: anchor.headingSource,
        routeHeadingAssumption: anchor.headingSource === 'self-route-motion-direction',
        horizontalFieldOfViewDegrees: 90,
        limitation: anchor.headingSource === 'nearby-observed-map-facing-direction'
          ? 'camera-heading-approximated-by-nearby-map-facing-direction'
          : 'camera-heading-approximated-by-self-route-direction',
      },
    });
  }
  return predictions;
}
