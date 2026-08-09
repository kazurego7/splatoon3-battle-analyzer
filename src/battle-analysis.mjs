function isCross(sample) {
  return sample.diagonalDown >= 0.2 && sample.diagonalUp >= 0.2;
}

function isAlive(sample) {
  return sample.saturatedRatio >= 0.35 && sample.grayRatio <= 0.18 && !isCross(sample);
}

function iconState(sample) {
  if (isCross(sample)) return 'dead';
  return 'alive';
}

function rawPlayerState(sample) {
  const timerVisible = sample.timer
    && sample.timer.darkRatio >= 0.22
    && sample.timer.whiteRatio >= 0.025
    && sample.timer.edgeRatio >= 0.035;
  if (!timerVisible) return null;
  const team = sample.team.map(iconState);
  const enemy = sample.enemy.map(iconState);
  const teamAlive = team.filter(state => state === 'alive').length;
  const enemyAlive = enemy.filter(state => state === 'alive').length;
  return {
    time: sample.time,
    teamAlive,
    enemyAlive,
    difference: teamAlive - enemyAlive,
    known: 8,
  };
}

function modeState(states) {
  const counts = new Map();
  for (const state of states) {
    const key = `${state.teamAlive}:${state.enemyAlive}`;
    const item = counts.get(key) || { count: 0, states: [] };
    item.count += 1;
    item.states.push(state);
    counts.set(key, item);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count)[0];
}

export function detectPlayerCounts(samples, { gameplayStart = 10, gameplayEnd = Infinity } = {}) {
  const buckets = new Map();
  for (const sample of samples) {
    if (sample.time < gameplayStart || sample.time > gameplayEnd) continue;
    const state = rawPlayerState(sample);
    if (!state) continue;
    const second = Math.floor(sample.time);
    const bucket = buckets.get(second) || [];
    bucket.push(state);
    buckets.set(second, bucket);
  }

  const observed = [];
  for (let second = Math.floor(gameplayStart); second <= Math.ceil(gameplayEnd); second += 1) {
    const states = buckets.get(second) || [];
    if (states.length < 2) continue;
    const mode = modeState(states);
    if (mode.count / states.length < 0.5) continue;
    const representative = mode.states[0];
    observed.push({
      time: second + 0.5,
      teamAlive: representative.teamAlive,
      enemyAlive: representative.enemyAlive,
      difference: representative.difference,
      source: 'observed',
      confidence: Math.min(1, (mode.count / states.length) * (representative.known / 8)),
    });
  }

  for (let index = 1; index < observed.length - 1; index += 1) {
    const previous = observed[index - 1];
    const current = observed[index];
    const next = observed[index + 1];
    if (next.time - previous.time <= 3
      && previous.teamAlive === next.teamAlive
      && previous.enemyAlive === next.enemyAlive
      && (current.teamAlive !== previous.teamAlive || current.enemyAlive !== previous.enemyAlive)) {
      Object.assign(current, {
        teamAlive: previous.teamAlive,
        enemyAlive: previous.enemyAlive,
        difference: previous.difference,
        confidence: Math.min(current.confidence, 0.65),
      });
    }
  }

  const timeline = [];
  let lastObserved = null;
  for (let second = Math.floor(gameplayStart); second <= Math.floor(gameplayEnd); second += 1) {
    const current = observed.find(state => Math.floor(state.time) === second);
    if (current) {
      lastObserved = current;
      timeline.push(current);
    } else if (lastObserved && second + 0.5 - lastObserved.time <= 5) {
      const age = second + 0.5 - lastObserved.time;
      timeline.push({
        ...lastObserved,
        time: second + 0.5,
        source: 'held',
        confidence: Math.max(0.2, lastObserved.confidence * (1 - age / 6)),
      });
    }
  }
  return timeline;
}

// Samples are 0.25 seconds apart. Tolerate one missed frame, but never bridge
// multi-second gaps: special-active icon flashes can resemble a gray cross.
function candidateRuns(samples, maxGap = 0.5) {
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
