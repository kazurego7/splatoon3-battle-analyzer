function darkRatio(frame, left, top, width, height) {
  let dark = 0;
  let total = 0;
  for (let y = top; y < top + height; y += 2) {
    for (let x = left; x < left + width; x += 2) {
      const at = (y * 960 + x) * 3;
      const luma = frame[at] * 0.299 + frame[at + 1] * 0.587 + frame[at + 2] * 0.114;
      if (luma < 70) dark += 1;
      total += 1;
    }
  }
  return dark / total;
}

function brightRatio(frame, left, top, width, height) {
  let bright = 0;
  let total = 0;
  for (let y = top; y < top + height; y += 2) {
    for (let x = left; x < left + width; x += 2) {
      const at = (y * 960 + x) * 3;
      const luma = frame[at] * 0.299 + frame[at + 1] * 0.587 + frame[at + 2] * 0.114;
      if (luma > 170) bright += 1;
      total += 1;
    }
  }
  return bright / total;
}

export function detectResultScreen(frame, time) {
  // The personal result has a bright stage banner at the top, a large dark
  // summary panel, and four bright equipment cards along the bottom. Requiring
  // all three regions avoids confusing map transitions or later menu pages for
  // the personal result without inspecting any other result screen.
  const panelDark = darkRatio(frame, 390, 105, 530, 405);
  const bannerDark = darkRatio(frame, 390, 15, 535, 90);
  const bannerBright = brightRatio(frame, 390, 15, 535, 90);
  const equipmentBright = brightRatio(frame, 430, 370, 455, 120);
  // Some stages (for example spa/interior result backdrops) keep most of the
  // stage banner dark. A small but stable bright image signal is sufficient
  // when the result panel and equipment cards both match their structure.
  if (panelDark < 0.68 || panelDark > 0.84
    || (bannerBright < 0.1 && bannerDark > 0.5)
    || equipmentBright < 0.12) return null;
  const confidence = Math.min(1,
    (panelDark - 0.68) / 0.12 * 0.35
    + Math.max((bannerBright - 0.1) / 0.25, (0.5 - bannerDark) / 0.35) * 0.35
    + (equipmentBright - 0.12) / 0.25 * 0.3);
  return {
    found: true,
    screenType: 'personal',
    absoluteTime: time,
    confidence: Number(Math.max(0.5, confidence).toFixed(3)),
    evidence: '個人リザルトのステージ見出し・戦績パネル・装備カードを構造検出',
  };
}

export function reconcileDeathsWithResult(deaths, expectedCount) {
  if (!Number.isInteger(expectedCount) || expectedCount < 0) return [];
  const ranked = deaths.map(death => ({
    death,
    respawnConfirmed: death.evidence?.detector === 'respawn-countdown-ui' || Boolean(death.evidence?.respawn),
  })).sort((left, right) => {
    if (left.respawnConfirmed !== right.respawnConfirmed) return left.respawnConfirmed ? -1 : 1;
    return (right.death.confidence || 0) - (left.death.confidence || 0) || left.death.time - right.death.time;
  });
  return ranked.slice(0, Math.min(expectedCount, deaths.length))
    .map(({ death }) => death)
    .sort((left, right) => left.time - right.time)
    .map((death, index) => ({ ...death, id: `death-${index + 1}` }));
}

export function chooseDeathCandidateSet(slotCandidates, expectedCount, preferredSlot = null) {
  if (!Number.isInteger(expectedCount) || !slotCandidates.length) return null;
  return slotCandidates.map(option => ({
    ...option,
    countDistance: Math.abs(option.deaths.length - expectedCount),
    respawnConfirmed: option.deaths.filter(death =>
      death.evidence?.detector === 'respawn-countdown-ui' || death.evidence?.respawn).length,
  })).sort((left, right) =>
    left.countDistance - right.countDistance
    || right.respawnConfirmed - left.respawnConfirmed
    || Number(right.slot === preferredSlot) - Number(left.slot === preferredSlot)
    || left.slot - right.slot)[0];
}
