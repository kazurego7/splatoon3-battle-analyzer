function rgbAt(frame, width, x, y) {
  const at = (y * width + x) * 3;
  return [frame[at], frame[at + 1], frame[at + 2]];
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
  return {
    time,
    neutralRatio: Number(neutralRatio.toFixed(4)),
    edgeRatio: Number(edgeRatio.toFixed(4)),
    score: Number((neutralRatio * 0.82 + edgeRatio * 0.18).toFixed(4)),
  };
}

export function selectObservedMapFrame(samples, deaths = []) {
  const deathWindows = samples.filter(sample => deaths.some(death => sample.time >= death.time + 0.5 && sample.time <= death.time + 5));
  const candidates = deathWindows.length ? deathWindows : samples;
  const best = [...candidates].sort((left, right) => right.score - left.score)[0];
  if (!best || best.neutralRatio < 0.21) return null;
  return {
    ...best,
    confidence: Number(Math.min(0.96, Math.max(0.35, (best.neutralRatio - 0.16) * 3.4)).toFixed(3)),
    source: 'observed-map-screen',
  };
}
