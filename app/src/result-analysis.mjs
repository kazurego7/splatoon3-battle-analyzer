import { extractRgbFrame } from './ffmpeg.mjs';
import { extractDigitGlyphs, rankGlyph } from './game-count-vision.mjs';
import { findResultTable, findSelfResultRow } from './player-identity.mjs';

function candidateTimes(activeEnd, searchEnd, directResultTime) {
  const personalSummaryTimes = Array.from({ length: 19 }, (_, index) => activeEnd - 6 + index * 2);
  const laterResultTimes = Array.from({ length: 14 }, (_, index) => activeEnd + 34 + index * 4);
  const fallback = [...personalSummaryTimes, ...laterResultTimes];
  if (Number.isFinite(directResultTime)) {
    fallback.unshift(directResultTime, directResultTime - 1, directResultTime + 1);
  }
  return fallback
    .map(time => Math.max(0, Math.min(searchEnd - 0.25, time)))
    .filter((time, index, values) => time <= searchEnd && values.indexOf(time) === index);
}

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

function readDigit(frame, x, y, thresholds = [160, 190]) {
  const totals = new Map();
  let observations = 0;
  for (const rowOffset of [0, 1]) {
    for (const threshold of thresholds) {
      const glyphs = extractDigitGlyphs(frame, 960, x, y + rowOffset, 8, threshold, 12);
      if (glyphs.length !== 1) continue;
      observations += 1;
      // Small result-screen glyphs use the original model. The count-HUD
      // calibration contains much larger source glyphs and is intentionally
      // isolated from this OCR path.
      for (const candidate of rankGlyph(glyphs[0], false)) {
        if (candidate.score > 0.48) continue;
        totals.set(candidate.digit, (totals.get(candidate.digit) || 0) + Math.exp(-candidate.score * 12));
      }
    }
  }
  const ranked = [...totals.entries()].sort((left, right) => right[1] - left[1]);
  if (observations < 2 || !ranked.length) return null;
  const confidence = ranked.length === 1 ? 1 : Math.max(0, Math.min(1, (ranked[0][1] - ranked[1][1]) / ranked[0][1]));
  return { digit: ranked[0][0], confidence };
}

function readTwoDigits(frame, tensX, onesX, y, thresholds) {
  const tens = readDigit(frame, tensX, y, thresholds);
  const ones = readDigit(frame, onesX, y, thresholds);
  if (!tens || !ones) return null;
  return {
    value: tens.digit * 10 + ones.digit,
    confidence: Math.min(tens.confidence, ones.confidence),
  };
}

export function analyzeResultFrame(frame, time) {
  const screen = detectResultScreen(frame, time);
  if (!screen) return null;
  if (screen.screenType === 'overall') {
    const resultRow = screen.resultRow;
    if (!resultRow) return null;
    const statsY = Math.round(resultRow.rowY + 3);
    const deaths = readTwoDigits(frame, 774, 780, statsY);
    if (deaths && deaths.value <= 40) return {
      found: true,
      screenType: 'overall',
      deathCount: deaths.value,
      absoluteTime: time,
      confidence: Number(deaths.confidence.toFixed(3)),
      evidence: '詳細リザルトの黄色い矢印行にある中央の戦績をローカルOCRで読み取り',
    };
    return null;
  }

  return screen;
}

export function detectResultScreen(frame, time) {
  const resultRow = findSelfResultRow(frame);
  const resultTable = resultRow || findResultTable(frame);
  if (resultTable) return {
    found: true,
    screenType: 'overall',
    absoluteTime: time,
    confidence: 1,
    resultRow: resultRow || null,
    resultTable,
    evidence: '全体リザルトの戦績表と本人行を検出',
  };

  const panelDark = darkRatio(frame, 390, 105, 530, 225);
  // The personal summary is a dark translucent panel over the stage image.
  // Gameplay leaves the lower panel bright, while black transitions make the
  // entire area dark; both previously produced plausible but false OCR digits.
  if (panelDark < 0.25 || panelDark > 0.83) return null;
  const summaryY = 146;
  const summaryThresholds = [130, 160, 190];
  const kills = readTwoDigits(frame, 756, 766, summaryY, summaryThresholds);
  const deaths = readTwoDigits(frame, 797, 805, summaryY, summaryThresholds);
  const specials = readTwoDigits(frame, 836, 843, summaryY, summaryThresholds);
  if (!kills || !deaths || !specials || kills.value > 40 || deaths.value > 40 || specials.value > 20) return null;
  return {
    found: true,
    screenType: 'personal',
    deathCount: deaths.value,
    absoluteTime: time,
    confidence: Number(Math.min(kills.confidence, deaths.confidence, specials.confidence).toFixed(3)),
    evidence: '個人戦績画面の中央の戦績をローカルOCRで読み取り',
  };
}

export async function analyzeResultLocally({ source, matchStart, activeEnd, matchEnd, directResultTime, preferredScreenType }) {
  let personalResult = null;
  for (const time of candidateTimes(activeEnd, matchEnd, directResultTime)) {
    const frame = await extractRgbFrame(source, time);
    const result = analyzeResultFrame(frame, time);
    if (!result) continue;
    if (result.screenType === 'overall' || preferredScreenType === 'personal') {
      return {
        found: true,
        screenType: result.screenType,
        deathCount: result.deathCount,
        time: Number((result.absoluteTime - matchStart).toFixed(2)),
        evidence: result.evidence,
        confidence: result.confidence,
        source: 'result-screen-local-ocr',
      };
    }
    personalResult ||= result;
  }
  const result = personalResult;
  if (!result) return null;
  return {
    found: true,
    screenType: result.screenType,
    deathCount: result.deathCount,
    time: Number((result.absoluteTime - matchStart).toFixed(2)),
    evidence: result.evidence,
    confidence: result.confidence,
    source: 'result-screen-local-ocr',
  };
}

export function reconcileDeathsWithResult(deaths, expectedCount) {
  if (!Number.isInteger(expectedCount) || expectedCount < 0) return [];
  if (deaths.length < expectedCount) return [];
  const ranked = deaths.map(death => ({
    death,
    respawnConfirmed: death.evidence?.detector === 'respawn-countdown-ui' || Boolean(death.evidence?.respawn),
  })).sort((left, right) => {
    if (left.respawnConfirmed !== right.respawnConfirmed) return left.respawnConfirmed ? -1 : 1;
    return (right.death.confidence || 0) - (left.death.confidence || 0) || left.death.time - right.death.time;
  });
  return ranked.slice(0, expectedCount)
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
