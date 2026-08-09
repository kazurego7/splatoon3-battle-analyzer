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

function isAllyBlue(frame, width, x, y) {
  const [r, g, b] = rgbAt(frame, width, x, y);
  return b > 65 && b > r * 1.22 && b > g * 1.12;
}

function isMarkerWhite(frame, width, x, y) {
  const [r, g, b] = rgbAt(frame, width, x, y);
  const maximum = Math.max(r, g, b);
  const minimum = Math.min(r, g, b);
  return minimum > 145 && maximum - minimum < 75;
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

export function detectMapAllies(frame, width, height) {
  const candidates = [];
  const left = Math.round(width * (250 / 960));
  const right = Math.round(width * (710 / 960));
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
        if (isAllyBlue(frame, width, x + offsetX, y + offsetY)) ringBlue += 1;
      }
      const ringRatio = ringBlue / allyRingOffsets.length;
      if (ringRatio < 0.6) continue;
      for (const [offsetX, offsetY] of allyOuterOffsets) {
        if (isAllyBlue(frame, width, x + offsetX, y + offsetY)) outerBlue += 1;
      }
      const outerRatio = outerBlue / allyOuterOffsets.length;
      const ringContrast = ringRatio - outerRatio;
      if (ringContrast < 0.23) continue;
      for (const [offsetX, offsetY] of allyInnerOffsets) {
        const pixelX = x + offsetX;
        const pixelY = y + offsetY;
        if (isAllyBlue(frame, width, pixelX, pixelY)) innerBlue += 1;
        if (isMarkerWhite(frame, width, pixelX, pixelY)) innerWhite += 1;
        if (Math.max(...rgbAt(frame, width, pixelX, pixelY)) < 65) innerDark += 1;
      }
      const innerBlueRatio = innerBlue / allyInnerOffsets.length;
      const innerWhiteRatio = innerWhite / allyInnerOffsets.length;
      const innerDarkRatio = innerDark / allyInnerOffsets.length;
      if (innerBlueRatio < 0.48 || innerWhiteRatio > 0.27 || innerDarkRatio < 0.025 || innerDarkRatio > 0.24) continue;

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
          innerBlueRatio: Number(innerBlueRatio.toFixed(3)),
          innerWhiteRatio: Number(innerWhiteRatio.toFixed(3)),
          pointerRatio: Number(pointerRatio.toFixed(3)),
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
  const position = mapCoordinates(width, height, best.x, best.y);
  return {
    screenX: best.x,
    screenY: best.y,
    ...position,
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
  if (mapUi.visible && candidate.neutralRatio >= 0.36 && candidate.score >= 0.32) {
    candidate.cursor = detectMapCursor(frame, width, height);
    candidate.allies = detectMapAllies(frame, width, height);
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
    const usable = run.filter(sample => sample.neutralRatio >= 0.36 && sample.allies?.length);
    if (!usable.length) return [];
    const sample = [...usable].sort((left, right) => right.allies.length - left.allies.length || left.time - right.time)[0];
    return sample.allies.map(marker => ({
      time: sample.time,
      x: marker.x,
      y: marker.y,
      directionDegrees: marker.directionDegrees,
      confidence: marker.confidence,
      source: 'observed-map-ally-marker',
      evidence: { ...marker.evidence, screen: { x: marker.screenX, y: marker.screenY }, observedUntil: run.at(-1).time },
    }));
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
    const averageWhite = cluster.observations.reduce((sum, item) => sum + item.evidence.innerWhiteRatio, 0) / cluster.observations.length;
    return distinctEpisodes >= 3 && averageWhite >= 0.15;
  });
  const observations = episodes.filter(observation => !staticIcons.some(icon => Math.hypot(icon.x - observation.x, icon.y - observation.y) <= 22));

  const tracks = [];
  for (const time of [...new Set(observations.map(item => item.time))].sort((left, right) => left - right)) {
    const atTime = observations.filter(item => item.time === time).sort((left, right) => right.confidence - left.confidence).slice(0, 3);
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
