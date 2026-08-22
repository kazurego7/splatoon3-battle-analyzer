// The countdown UI becomes observable after the actual splat. Human-reviewed
// deaths across multiple matches put that delay at a median of 2.5 seconds.
// Keep the UI's measured time in evidence, but calibrate the event timestamp so
// downstream review seeks to the splat rather than the later countdown.
export const RESPAWN_UI_DEATH_OFFSET_SECONDS = 2.5;

function estimatedDeathTime(respawn) {
  return Number(Math.max(0, respawn.time - RESPAWN_UI_DEATH_OFFSET_SECONDS).toFixed(2));
}

export function attachRespawnEvidence(deaths, respawnRuns) {
  const usedRespawns = new Set();
  const merged = deaths.map(death => {
    const candidate = respawnRuns
      .map((run, index) => ({ run, index, distance: Math.abs(run.time - death.time) }))
      .filter(({ run, index }) => !usedRespawns.has(index) && run.time >= death.time - 10 && run.time <= death.end + 7)
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
    const respawnEstimate = estimatedDeathTime(respawn);
    const eventTime = Math.min(death.time, respawnEstimate);
    const delay = Number((respawn.time - eventTime).toFixed(2));
    const timestampSource = eventTime < death.time ? 'respawn-ui-fallback' : 'self-hud-cross';
    return {
      ...death,
      time: eventTime,
      duration: Math.max(0, death.end - eventTime),
      detail: eventTime < death.time
        ? `上部HUDより先に復活UIを確認したため、実測した表示遅延${RESPAWN_UI_DEATH_OFFSET_SECONDS}秒を差し引いてデス時刻を推定しました。`
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
          respawnUiOnsetOffset: RESPAWN_UI_DEATH_OFFSET_SECONDS,
        },
      },
    };
  });

  for (const [index, respawn] of respawnRuns.entries()) {
    if (usedRespawns.has(index)) continue;
    const eventTime = estimatedDeathTime(respawn);
    merged.push({
      ...respawn,
      time: eventTime,
      duration: Math.max(0, respawn.end - eventTime),
      detail: `上部HUDを確認できない区間のため、復活UIの初出から実測表示遅延${RESPAWN_UI_DEATH_OFFSET_SECONDS}秒を差し引いてデス時刻を推定しています。`,
      evidence: {
        ...respawn.evidence,
        timing: {
          timestampSource: 'respawn-ui-fallback',
          hudDetectedAt: null,
          respawnUiDetectedAt: respawn.time,
          respawnUiDelay: RESPAWN_UI_DEATH_OFFSET_SECONDS,
          respawnUiOnsetOffset: RESPAWN_UI_DEATH_OFFSET_SECONDS,
        },
      },
    });
  }

  return merged
    .sort((left, right) => left.time - right.time)
    .map((death, index) => ({ ...death, id: `death-${index + 1}` }));
}
