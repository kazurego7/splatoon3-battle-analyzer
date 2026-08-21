function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function rollingDensityFlags(flags, radius, threshold) {
  return flags.map((_, index) => {
    let total = 0;
    let active = 0;
    for (let sample = Math.max(0, index - radius); sample <= Math.min(flags.length - 1, index + radius); sample += 1) {
      total += 1;
      if (flags[sample]) active += 1;
    }
    return active / total >= threshold;
  });
}

export function classifySamples(samples, interval) {
  const diffMedian = median(samples.map(sample => sample.difference).filter(Boolean));
  const hudEdgeMedian = median(samples.map(sample => sample.hudEdgeRatio));
  return samples.map(sample => {
    const hud = sample.hudWhiteRatio >= 0.012 && sample.hudEdgeRatio >= Math.max(0.035, hudEdgeMedian * 0.9);
    const active = sample.difference >= Math.max(5.5, diffMedian * 0.55) && sample.saturation >= 0.18 && sample.brightness >= 28;
    const gameScore = (hud ? 0.62 : 0) + Math.min(0.25, sample.hudEdgeRatio * 2.2) + (active ? 0.28 : 0);
    const ruleScore = ruleIntroScore(sample);
    return { ...sample, hud, active, gameScore, gameplay: gameScore >= 0.7, ruleScore, ruleIntro: ruleScore >= 0.82, interval };
  });
}

export function ruleIntroScore(sample) {
  if (sample.centerDarkRatio == null) return 0;
  return (
    // The rule card's black ink occupies a stable quarter of the center crop.
    // Wider bounds also match the map overlay, player pose, logo, and XP cards.
    (sample.centerDarkRatio >= 0.22 && sample.centerDarkRatio <= 0.315 ? 0.42 : 0)
    // Some stage backgrounds leave slightly less white inside the crop.
    + (sample.centerWhiteRatio >= 0.025 && sample.centerWhiteRatio <= 0.14 ? 0.25 : 0)
    + (sample.centerEdgeRatio >= 0.095 ? 0.25 : 0)
    + (sample.saturation >= 0.18 ? 0.08 : 0)
  );
}

function density(flags, start, end) {
  let active = 0;
  let total = 0;
  for (let index = Math.max(0, start); index < Math.min(flags.length, end); index += 1) {
    total += 1;
    if (flags[index]) active += 1;
  }
  return total ? active / total : 0;
}

function introStarts(classified, activityFlags, interval) {
  const candidates = [];
  let cluster = [];
  const flush = () => {
    if (!cluster.length) return;
    const best = cluster.reduce((winner, sample) => sample.ruleScore > winner.ruleScore ? sample : winner);
    const index = classified.indexOf(best);
    const futureStart = index + Math.ceil(8 / interval);
    const futureEnd = index + Math.ceil(120 / interval);
    const futureActive = activityFlags.slice(futureStart, futureEnd).filter(Boolean).length;
    candidates.push({ time: best.time, futureActive });
    cluster = [];
  };
  for (const sample of classified) {
    if (sample.ruleIntro) {
      if (cluster.length && sample.time - cluster.at(-1).time > interval * 2) flush();
      cluster.push(sample);
    } else if (cluster.length) flush();
  }
  flush();
  // A set/power result can resemble the intro card about 30–45 seconds before
  // the real next intro. In that short pair, the later candidate is the start.
  const collapsed = [];
  for (const candidate of candidates) {
    if (collapsed.length && candidate.time - collapsed.at(-1).time <= 60) collapsed[collapsed.length - 1] = candidate;
    else collapsed.push(candidate);
  }
  const minimumFutureSamples = Math.max(3, Math.ceil(6 / interval));
  return collapsed
    .filter(candidate => candidate.futureActive >= minimumFutureSamples)
    .map(candidate => candidate.time)
    .filter((time, index, values) => index === 0 || time - values[index - 1] >= 120);
}

export function detectMatchSegments(classified, duration, interval) {
  const activityFlags = classified.map(sample => sample.active ?? sample.gameplay);
  // Motion/color activity remains available when a team color makes the white HUD
  // detector unreliable. It also separates the long lobby between matches.
  const flags = rollingDensityFlags(activityFlags, Math.ceil(16 / interval), 0.35);
  const activeRuns = [];
  let startIndex = -1;
  for (let index = 0; index <= flags.length; index += 1) {
    if (index < flags.length && flags[index]) {
      if (startIndex < 0) startIndex = index;
    } else if (startIndex >= 0) {
      const activeStart = classified[startIndex].time;
      const activeEnd = classified[index - 1].time + interval;
      if (activeEnd - activeStart >= 75) {
        activeRuns.push({ activeStart, activeEnd });
      }
      startIndex = -1;
    }
  }
  const starts = introStarts(classified, activityFlags, interval);
  if (starts.length) {
    return starts.map((start, index) => {
      const nextStart = starts[index + 1] ?? duration;
      const latestRunStart = Math.min(nextStart - 30, start + 60);
      const runCandidates = activeRuns.filter(run =>
        run.activeEnd > start
        && run.activeStart >= start - 60
        && run.activeStart < latestRunStart);
      const activeEnd = runCandidates.length ? Math.max(...runCandidates.map(run => run.activeEnd)) : Math.min(nextStart, start + 360);
      const end = index + 1 < starts.length
        ? Math.min(nextStart - 3, activeEnd + 70)
        // The personal result used for K/D and self-weapon validation can appear
        // close to a minute after gameplay ends.
        : Math.min(duration, activeEnd + 90);
      return { activeStart: start, activeEnd, start, end: Math.max(start + 60, end), detection: 'rule-intro' };
    });
  }
  const segments = activeRuns.map((run, index) => ({
    ...run,
    start: Math.max(0, run.activeStart - 25),
    end: Math.min(duration, activeRuns[index + 1]?.activeStart - 3 || duration, run.activeEnd + 90),
  }));
  for (let index = 1; index < segments.length; index += 1) {
    const previous = segments[index - 1];
    const current = segments[index];
    if (previous.end > current.start) {
      const boundary = (previous.activeEnd + current.activeStart) / 2;
      previous.end = boundary;
      current.start = boundary;
    }
  }
  return segments;
}
