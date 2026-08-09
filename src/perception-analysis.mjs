export function buildDeathCameraDetections(deaths, { maximumDuration = 3.25 } = {}) {
  return deaths.flatMap((death, index) => {
    const respawnDetectedAt = death.evidence?.timing?.respawnUiDetectedAt;
    if (respawnDetectedAt == null) return [];
    const start = death.time + 0.75;
    const end = Math.min(death.time + maximumDuration, Math.max(start + 0.5, respawnDetectedAt + 1));
    if (end <= start) return [];
    return [{
      id: `enemy-death-camera-${index + 1}`,
      team: 'enemy',
      kind: 'death-camera-focus-candidate',
      weapon: null,
      confidence: Number(Math.min(0.78, (death.confidence || 0.5) * 0.76).toFixed(3)),
      frames: [
        [Number(start.toFixed(2)), 0.22, 0.17, 0.56, 0.68],
        [Number(end.toFixed(2)), 0.22, 0.17, 0.56, 0.68],
      ],
      evidence: {
        detector: 'confirmed-death-camera-window',
        deathId: death.id,
        deathTime: death.time,
        respawnUiDetectedAt: respawnDetectedAt,
        limitation: 'focus-area-not-object-bounding-box',
      },
    }];
  });
}

function isEnemyOrange(frame, width, x, y) {
  const at = (y * width + x) * 3;
  const r = frame[at];
  const g = frame[at + 1];
  const b = frame[at + 2];
  return r > 105 && g > 45 && r > b * 1.45 && g > b * 1.15 && r > g * 1.08;
}

export function analyzeEnemyColorFrame(frame, previous, width, height, time) {
  const mask = new Uint8Array(width * height);
  const expanded = new Uint8Array(width * height);
  const left = Math.round(width * 0.16);
  const right = Math.round(width * 0.84);
  const top = Math.round(height * 0.16);
  const bottom = Math.round(height * 0.84);
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      if (!isEnemyOrange(frame, width, x, y)) continue;
      mask[y * width + x] = 1;
      for (let offsetY = -2; offsetY <= 2; offsetY += 1) {
        for (let offsetX = -2; offsetX <= 2; offsetX += 1) expanded[(y + offsetY) * width + x + offsetX] = 1;
      }
    }
  }

  const seen = new Uint8Array(width * height);
  const candidates = [];
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const start = y * width + x;
      if (!expanded[start] || seen[start]) continue;
      const queue = [start];
      seen[start] = 1;
      let minimumX = x;
      let maximumX = x;
      let minimumY = y;
      let maximumY = y;
      while (queue.length) {
        const current = queue.pop();
        const currentY = Math.floor(current / width);
        const currentX = current - currentY * width;
        minimumX = Math.min(minimumX, currentX);
        maximumX = Math.max(maximumX, currentX);
        minimumY = Math.min(minimumY, currentY);
        maximumY = Math.max(maximumY, currentY);
        const neighbors = [];
        if (currentY > 0) neighbors.push(current - width);
        if (currentY + 1 < height) neighbors.push(current + width);
        if (currentX > 0) neighbors.push(current - 1);
        if (currentX + 1 < width) neighbors.push(current + 1);
        for (const next of neighbors) {
          if (next < 0 || next >= expanded.length || seen[next] || !expanded[next]) continue;
          seen[next] = 1;
          queue.push(next);
        }
      }
      const boxWidth = maximumX - minimumX + 1;
      const boxHeight = maximumY - minimumY + 1;
      const boxArea = boxWidth * boxHeight;
      if (boxWidth < 12 || boxHeight < 14 || boxWidth > width * 0.3 || boxHeight > height * 0.48) continue;
      if (boxHeight / boxWidth < 0.48 || boxHeight / boxWidth > 3.2) continue;
      let orange = 0;
      let changed = 0;
      for (let pixelY = minimumY; pixelY <= maximumY; pixelY += 1) {
        for (let pixelX = minimumX; pixelX <= maximumX; pixelX += 1) {
          if (!mask[pixelY * width + pixelX]) continue;
          orange += 1;
          if (previous) {
            const at = (pixelY * width + pixelX) * 3;
            const difference = Math.abs(frame[at] - previous[at]) + Math.abs(frame[at + 1] - previous[at + 1]) + Math.abs(frame[at + 2] - previous[at + 2]);
            if (difference >= 80) changed += 1;
          }
        }
      }
      const density = orange / boxArea;
      const motionRatio = previous ? changed / Math.max(1, orange) : 0;
      if (orange < 65 || density < 0.07 || motionRatio < 0.22) continue;
      const centerX = (minimumX + maximumX) / 2;
      const centerY = (minimumY + maximumY) / 2;
      const centrality = Math.max(0, 1 - Math.hypot((centerX / width - 0.5) / 0.42, (centerY / height - 0.52) / 0.42));
      const shape = Math.min(1, boxHeight / Math.max(1, boxWidth));
      const score = density * 0.32 + motionRatio * 0.28 + centrality * 0.25 + shape * 0.15;
      candidates.push({
        time,
        x: minimumX / width,
        y: minimumY / height,
        width: boxWidth / width,
        height: boxHeight / height,
        centerX: centerX / width,
        centerY: centerY / height,
        confidence: Number(Math.min(0.72, Math.max(0.35, score)).toFixed(3)),
        evidence: { density: Number(density.toFixed(3)), motionRatio: Number(motionRatio.toFixed(3)), shape: Number(shape.toFixed(3)) },
      });
    }
  }
  return { time, candidates: candidates.sort((leftCandidate, rightCandidate) => rightCandidate.confidence - leftCandidate.confidence).slice(0, 4) };
}

export function detectEnemyColorMotionRuns(samples, deaths, { lookback = 4 } = {}) {
  const detections = [];
  for (const death of deaths) {
    const window = samples.filter(sample => sample.time >= death.time - lookback && sample.time <= death.time - 0.25);
    let run = [];
    let bestRun = [];
    for (const sample of window) {
      const previous = run.at(-1);
      const candidate = sample.candidates
        .filter(item => !previous || Math.hypot(item.centerX - previous.centerX, item.centerY - previous.centerY) <= 0.2)
        .sort((left, right) => right.confidence - left.confidence)[0];
      if (!candidate) {
        if (run.length > bestRun.length) bestRun = run;
        run = [];
        continue;
      }
      if (previous && sample.time - previous.time > 0.75) {
        if (run.length > bestRun.length) bestRun = run;
        run = [];
      }
      run.push(candidate);
    }
    if (run.length > bestRun.length) bestRun = run;
    if (bestRun.length < 2) continue;
    const averageConfidence = bestRun.reduce((sum, item) => sum + item.confidence, 0) / bestRun.length;
    detections.push({
      id: `enemy-color-motion-${detections.length + 1}`,
      team: 'enemy',
      kind: 'enemy-color-motion-candidate',
      weapon: null,
      confidence: Number(Math.min(0.68, averageConfidence * 0.9).toFixed(3)),
      frames: bestRun.map(item => [item.time, item.x, item.y, item.width, item.height]),
      evidence: {
        detector: 'enemy-color-shape-motion-continuity',
        deathId: death.id,
        deathTime: death.time,
        sampleCount: bestRun.length,
        limitation: 'color-motion-candidate-not-confirmed-player',
      },
    });
  }
  return detections;
}
