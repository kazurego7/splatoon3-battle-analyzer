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
    const ruleScore = sample.centerDarkRatio == null ? 0 : (
      (sample.centerDarkRatio >= 0.18 && sample.centerDarkRatio <= 0.62 ? 0.42 : 0)
      + (sample.centerWhiteRatio >= 0.03 && sample.centerWhiteRatio <= 0.14 ? 0.25 : 0)
      + (sample.centerEdgeRatio >= 0.095 ? 0.25 : 0)
      + (sample.saturation >= 0.18 ? 0.08 : 0)
    );
    return { ...sample, hud, active, gameScore, gameplay: gameScore >= 0.7, ruleScore, ruleIntro: ruleScore >= 0.82, interval };
  });
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

function introStarts(classified, rawFlags, interval) {
  const candidates = [];
  let cluster = [];
  const flush = () => {
    if (!cluster.length) return;
    const best = cluster.reduce((winner, sample) => sample.ruleScore > winner.ruleScore ? sample : winner);
    const index = classified.indexOf(best);
    const future = density(rawFlags, index + Math.ceil(8 / interval), index + Math.ceil(120 / interval));
    if (future >= 0.35) candidates.push(best.time);
    cluster = [];
  };
  for (const sample of classified) {
    if (sample.ruleIntro) {
      if (cluster.length && sample.time - cluster.at(-1).time > interval * 2) flush();
      cluster.push(sample);
    } else if (cluster.length) flush();
  }
  flush();
  return candidates.filter((time, index) => index === 0 || time - candidates[index - 1] >= 120);
}

export function detectMatchSegments(classified, duration, interval) {
  const rawFlags = classified.map(sample => sample.gameplay);
  // A rolling density tolerates death/map screens without joining the low-density lobby
  // between matches. At a two-second sample interval this uses roughly a 34-second window.
  const flags = rollingDensityFlags(rawFlags, Math.ceil(16 / interval), 0.35);
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
  const starts = introStarts(classified, rawFlags, interval);
  if (starts.length) {
    return starts.map((start, index) => {
      const nextStart = starts[index + 1] ?? duration;
      const runCandidates = activeRuns.filter(run => run.activeEnd > start && run.activeStart >= start - 30 && run.activeStart < nextStart - 30);
      const activeEnd = runCandidates.length ? Math.max(...runCandidates.map(run => run.activeEnd)) : Math.min(nextStart, start + 360);
      const end = index + 1 < starts.length
        ? Math.min(nextStart - 28, activeEnd + 40)
        // The final recording often continues into the lobby/menu. Keep enough
        // time for the result sequence without swallowing that unrelated tail.
        : Math.min(duration, activeEnd + 28);
      return { activeStart: start, activeEnd, start, end: Math.max(start + 60, end), detection: 'rule-intro' };
    });
  }
  const segments = activeRuns.map(run => ({
    ...run,
    start: Math.max(0, run.activeStart - 25),
    end: Math.min(duration, run.activeEnd + 35),
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

export function analysisEvents(classified, clipStart, clipEnd) {
  const within = classified.filter(sample => sample.time >= clipStart && sample.time <= clipEnd);
  const ranked = [...within]
    .filter(sample => sample.difference > 12)
    .sort((a, b) => b.difference - a.difference);
  const selected = [];
  for (const sample of ranked) {
    if (selected.every(item => Math.abs(item.time - sample.time) >= 20)) selected.push(sample);
    if (selected.length >= 6) break;
  }
  return selected
    .sort((a, b) => a.time - b.time)
    .map((sample, index) => ({
      id: `scene-${index + 1}`,
      time: Math.max(0, sample.time - clipStart),
      type: 'analysis',
      title: '画面状況が大きく変化',
      detail: '映像のフレーム差分が大きい場面です。交戦、デス、マップ表示などの可能性を動画で確認してください。',
      confidence: Math.min(0.95, sample.difference / 45),
      evidence: { difference: sample.difference, hud: sample.hud },
    }));
}
