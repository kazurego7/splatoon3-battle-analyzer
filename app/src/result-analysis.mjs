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

function readDigit(frame, x, y, thresholds = [160, 190]) {
  const totals = new Map();
  const winners = [];
  let observations = 0;
  for (const rowOffset of [0, 1]) {
    for (const threshold of thresholds) {
      const glyphs = extractDigitGlyphs(frame, 960, x, y + rowOffset, 8, threshold, 12);
      if (glyphs.length !== 1) continue;
      observations += 1;
      const rankedCandidates = rankGlyph(glyphs[0], false);
      if (rankedCandidates[0]) winners.push({ threshold, digit: rankedCandidates[0].digit });
      for (const candidate of rankedCandidates) {
        if (candidate.score > 0.48) continue;
        totals.set(candidate.digit, (totals.get(candidate.digit) || 0) + Math.exp(-candidate.score * 12));
      }
    }
  }
  const ranked = [...totals.entries()].sort((left, right) => right[1] - left[1]);
  if (observations < 2 || !ranked.length) return null;
  const highThresholdFour = winners.some(item => item.threshold === 190 && item.digit === 4);
  const lowThresholdShape = winners.filter(item => item.threshold === 130).map(item => item.digit);
  if (highThresholdFour && lowThresholdShape.length && lowThresholdShape.every(digit => digit === 9 || digit === 1)) {
    return { digit: 4, confidence: 0.5 };
  }
  const confidence = ranked.length === 1 ? 1 : Math.max(0, Math.min(1, (ranked[0][1] - ranked[1][1]) / ranked[0][1]));
  return { digit: ranked[0][0], confidence };
}

function readTwoDigits(frame, tensX, onesX, y, thresholds) {
  const tens = readDigit(frame, tensX, y, thresholds);
  let ones = readDigit(frame, onesX, y, thresholds);
  if (!ones) {
    const shifted = [-4, -2, 2].map(offset => readDigit(frame, onesX + offset, y, thresholds)).filter(Boolean);
    ones = shifted.sort((left, right) => right.confidence - left.confidence)[0] || null;
  }
  if (!tens || !ones) return null;
  return { value: tens.digit * 10 + ones.digit, confidence: Math.min(tens.confidence, ones.confidence) };
}

// Personal-result counts use a fixed 5x13-pixel font at the 960x540 analysis
// size. Column projections are more stable here than the much larger in-match
// counter OCR model, especially for a narrow leading 1. These prototypes are
// font shapes (not per-match values) and are compared at the same fixed scale.
const RESULT_DIGIT_PROTOTYPES = [
  [0, [8, 4, 2, 4, 7]], [1, [0, 1, 9, 7, 0]],
  [2, [7, 7, 3, 6, 6]], [3, [3, 2, 4, 6, 8]],
  [4, [5, 3, 2, 9, 5]], [5, [5, 7, 4, 6, 6]],
  [6, [8, 6, 3, 5, 7]], [7, [1, 1, 4, 9, 4]],
  [8, [8, 6, 4, 8, 7]], [9, [5, 4, 3, 7, 9]],
];
const RESULT_TENS_PROTOTYPES = [
  [0, [9, 4, 2, 9, 7]], [1, [0, 2, 9, 3, 0]], [2, [7, 4, 3, 7, 5]],
];

function brightColumnProfile(frame, startX, { startY = 145, height = 13, threshold = 160 } = {}) {
  const profile = [];
  for (let x = startX; x < startX + 5; x += 1) {
    let count = 0;
    for (let y = startY; y < startY + height; y += 1) {
      const at = (y * 960 + x) * 3;
      const luma = frame[at] * 0.299 + frame[at + 1] * 0.587 + frame[at + 2] * 0.114;
      if (luma >= threshold) count += 1;
    }
    profile.push(count);
  }
  return profile;
}

function classifyResultProfile(profile, prototypes) {
  const ranked = prototypes.map(([digit, expected]) => ({
    digit,
    distance: expected.reduce((sum, value, index) => sum + (value - profile[index]) ** 2, 0),
  })).sort((left, right) => left.distance - right.distance);
  const margin = ranked[1] ? (ranked[1].distance - ranked[0].distance) / Math.max(1, ranked[1].distance) : 1;
  return { digit: ranked[0].digit, confidence: Number(Math.max(0, Math.min(1, margin)).toFixed(3)), profile };
}

export function readPersonalResultKillCount(frame) {
  if (!frame || frame.length < 960 * 540 * 3) return null;
  const tens = classifyResultProfile(brightColumnProfile(frame, 761), RESULT_TENS_PROTOTYPES);
  const ones = classifyResultProfile(brightColumnProfile(frame, 768), RESULT_DIGIT_PROTOTYPES);
  const value = tens.digit * 10 + ones.digit;
  if (value > 40) return null;
  return { value, confidence: Number(Math.min(tens.confidence, ones.confidence).toFixed(3)), evidence: { tens: tens.profile, ones: ones.profile } };
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

export function analyzePersonalResultFrame(frame, time) {
  const screen = detectResultScreen(frame, time);
  if (!screen) return null;
  const kills = readPersonalResultKillCount(frame);
  const deaths = readTwoDigits(frame, 797, 805, 146, [130, 160, 190]);
  if (!kills || !deaths || deaths.value > 40) return null;
  return {
    ...screen,
    killCount: kills.value,
    deathCount: deaths.value,
    confidence: Number(Math.min(screen.confidence, kills.confidence, deaths.confidence).toFixed(3)),
    evidence: `${screen.evidence}。キル・デスをローカルOCRで読取`,
    source: 'personal-result-local-ocr',
  };
}

export function analyzePersonalDeathCountFrame(frame, time) {
  const screen = detectResultScreen(frame, time);
  if (!screen) return null;
  const deaths = readTwoDigits(frame, 797, 805, 146, [130, 160, 190]);
  if (!deaths || deaths.value > 40) return null;
  return {
    ...screen,
    deathCount: deaths.value,
    confidence: Number(Math.min(screen.confidence, deaths.confidence).toFixed(3)),
    evidence: `${screen.evidence}。デス数をローカルOCRで読取`,
    source: 'personal-result-local-death-ocr',
  };
}

export async function analyzePersonalResultLocally({ source, matchStart, resultTime }) {
  for (const offset of [0, -0.25, 0.25, -0.5, 0.5]) {
    const absoluteTime = Math.max(matchStart, resultTime + offset);
    const result = analyzePersonalResultFrame(await extractRgbFrame(source, absoluteTime), absoluteTime);
    if (!result) continue;
    return {
      ...result,
      time: Number((absoluteTime - matchStart).toFixed(3)),
    };
  }
  return null;
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
import { extractRgbFrame } from './ffmpeg.mjs';
import { extractDigitGlyphs, rankGlyph } from './game-count-vision.mjs';
