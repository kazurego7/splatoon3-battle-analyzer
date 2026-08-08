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
  return deaths.filter(death => !ignored.some(([start, end]) => death.time >= start && death.time <= end));
}

export function attachRespawnEvidence(deaths, respawnRuns) {
  return deaths.map((death, index) => {
    const respawn = respawnRuns.find(run => run.time >= death.time - 1 && run.time <= death.end + 7);
    const result = respawn ? {
      ...death,
      detail: '画面右下の「復活まであとX秒」UIを連続フレームで確認した場面です。',
      confidence: Math.max(death.confidence, respawn.confidence),
      evidence: { ...death.evidence, respawn: respawn.evidence },
    } : death;
    return { ...result, id: `death-${index + 1}` };
  });
}
