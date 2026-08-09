// Human-verified facts are kept separate from automatic observations. They are
// used as regression fixtures while the visual detectors are improved.
const verified = {
  '2026-08-08 15-20-32.mp4': {
    1: {
      resultDeaths: 9,
      ignoredDeathWindows: [[30, 45]],
      stage: 'タカアシ経済特区',
      rule: 'エリア',
      stageAsset: 'タカアシ経済特区_エリア.webp',
    },
    2: { stage: 'タカアシ経済特区', rule: 'エリア', stageAsset: 'タカアシ経済特区_エリア.webp' },
    3: { stage: 'タカアシ経済特区', rule: 'エリア', stageAsset: 'タカアシ経済特区_エリア.webp' },
    4: { stage: 'タカアシ経済特区', rule: 'エリア', stageAsset: 'タカアシ経済特区_エリア.webp' },
  },
};

export function verifiedAnalysis(sourceFileName, matchNumber) {
  return verified[sourceFileName]?.[matchNumber] || null;
}

export function applyVerifiedDeathWindows(deaths, override) {
  const ignored = override?.ignoredDeathWindows || [];
  return deaths
    .filter(death => !ignored.some(([start, end]) => death.time >= start && death.time <= end))
    .map((death, index) => ({ ...death, id: `death-${index + 1}` }));
}

export function attachRespawnEvidence(deaths, respawnRuns) {
  const usedRespawns = new Set();
  const merged = deaths.map(death => {
    const candidate = respawnRuns
      .map((run, index) => ({ run, index, distance: Math.abs(run.time - death.time) }))
      .filter(({ run, index }) => !usedRespawns.has(index) && run.time >= death.time - 7 && run.time <= death.end + 7)
      .sort((left, right) => left.distance - right.distance)[0];
    if (!candidate) {
      return {
        ...death,
        evidence: {
          ...death.evidence,
          timing: { timestampSource: 'self-hud-cross', hudDetectedAt: death.time, respawnUiDetectedAt: null, respawnUiDelay: null },
        },
      };
    }

    usedRespawns.add(candidate.index);
    const respawn = candidate.run;
    const eventTime = Math.min(death.time, respawn.time);
    const delay = Number((respawn.time - eventTime).toFixed(2));
    const timestampSource = respawn.time < death.time ? 'respawn-ui-fallback' : 'self-hud-cross';
    return {
      ...death,
      time: eventTime,
      duration: Math.max(0, death.end - eventTime),
      detail: respawn.time < death.time
        ? `上部HUDが隠れていたため復活UIの初出をデス時刻とし、HUDのデス状態は${(death.time - respawn.time).toFixed(2).replace(/\.00$/, '')}秒後に確認しました。`
        : delay > 0
          ? `上部HUDでデス状態を検出し、右下の復活UIは${delay.toFixed(2).replace(/\.00$/, '')}秒後に確認しました。`
          : '上部HUDのデス状態と右下の復活UIを同時刻に確認しました。',
      confidence: Math.max(death.confidence, respawn.confidence),
      evidence: {
        ...death.evidence,
        respawn: { ...respawn.evidence, detectedAt: respawn.time },
        timing: {
          timestampSource,
          hudDetectedAt: death.time,
          respawnUiDetectedAt: respawn.time,
          respawnUiDelay: delay,
        },
      },
    };
  });

  for (const [index, respawn] of respawnRuns.entries()) {
    if (usedRespawns.has(index)) continue;
    merged.push({
      ...respawn,
      detail: '上部HUDを確認できない区間のため、右下の復活UIが最初に確認できた時刻をデス時刻として扱っています。',
      evidence: {
        ...respawn.evidence,
        timing: {
          timestampSource: 'respawn-ui-fallback',
          hudDetectedAt: null,
          respawnUiDetectedAt: respawn.time,
          respawnUiDelay: null,
        },
      },
    });
  }

  return merged
    .sort((left, right) => left.time - right.time)
    .map((death, index) => ({ ...death, id: `death-${index + 1}` }));
}
