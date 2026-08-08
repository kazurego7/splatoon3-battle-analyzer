function isCross(sample) {
  return sample.diagonalDown >= 0.2 && sample.diagonalUp >= 0.2;
}

function isAlive(sample) {
  return sample.saturatedRatio >= 0.35 && sample.grayRatio <= 0.18 && !isCross(sample);
}

function candidateRuns(samples, maxGap = 5) {
  const runs = [];
  for (const sample of samples.filter(isCross)) {
    const previous = runs.at(-1);
    const score = Math.min(sample.diagonalDown, sample.diagonalUp);
    if (previous && sample.time - previous.end <= maxGap) {
      previous.end = sample.time;
      if (score > previous.peakScore) {
        previous.peak = sample;
        previous.peakScore = score;
      }
    } else {
      runs.push({ start: sample.time, end: sample.time, peak: sample, peakScore: score });
    }
  }
  return runs;
}

function stableAliveAt(samples, startIndex, required = 3) {
  for (let index = startIndex; index <= samples.length - required; index += 1) {
    if (samples.slice(index, index + required).every(isAlive)) return samples[index].time;
  }
  return null;
}

export function detectSelfDeaths(samples, { duration, gameplayEnd = duration } = {}) {
  const eligibleEnd = Math.min(duration, gameplayEnd + 0.5);
  const accepted = candidateRuns(samples)
    .filter(run => run.start >= 10 && run.start <= eligibleEnd && run.end - run.start >= 1)
    .filter((run, index, runs) => index === 0 || run.start - runs[index - 1].start >= 10);

  return accepted.map((run, index) => {
    const searchStart = samples.findIndex(sample => sample.time >= run.start + 4);
    const nextAlive = stableAliveAt(samples, Math.max(0, searchStart));
    const end = nextAlive == null || nextAlive > eligibleEnd
      ? eligibleEnd
      : Math.max(run.start + 1, nextAlive);
    const confidence = Math.max(0.65, Math.min(0.99, 0.62 + run.peakScore * 0.75));
    return {
      id: `death-${index + 1}`,
      time: run.start,
      end,
      duration: Math.max(0, end - run.start),
      type: 'death',
      title: '自分がデス',
      detail: '画面上部の自分のブキアイコンが、チーム色から灰色の×表示へ変化した場面です。',
      confidence,
      evidence: {
        detector: 'self-hud-cross',
        diagonalDown: run.peak.diagonalDown,
        diagonalUp: run.peak.diagonalUp,
        candidateEnd: run.end,
      },
    };
  });
}
