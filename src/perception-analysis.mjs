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
