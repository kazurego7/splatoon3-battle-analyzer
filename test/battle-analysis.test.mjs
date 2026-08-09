import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPlayerCounts, detectSelfDeaths } from '../src/battle-analysis.mjs';
import { stabilizeGameCount } from '../src/game-count-vision.mjs';
import { findSelfResultRow } from '../src/player-identity.mjs';
import { analyzeMapCandidate, selectObservedMapFrame } from '../src/map-analysis.mjs';
import { applyVerifiedDeathWindows, attachRespawnEvidence, verifiedAnalysis } from '../src/analysis-overrides.mjs';

function sample(time, state = 'alive') {
  if (state === 'cross') return { time, saturatedRatio: 0.08, grayRatio: 0.32, diagonalDown: 0.4, diagonalUp: 0.38 };
  if (state === 'unknown') return { time, saturatedRatio: 0.12, grayRatio: 0.12, diagonalDown: 0.05, diagonalUp: 0.06 };
  return { time, saturatedRatio: 0.58, grayRatio: 0.06, diagonalDown: 0.03, diagonalUp: 0.04 };
}

test('detects HUD cross runs and collapses map-screen duplicates', () => {
  const samples = [];
  for (let time = 0; time <= 60; time += 0.25) {
    let state = 'alive';
    if (time >= 20 && time <= 22) state = 'cross';
    if (time > 22 && time < 27) state = 'unknown';
    if (time >= 25 && time <= 25.5) state = 'cross';
    if (time >= 42 && time <= 44) state = 'cross';
    samples.push(sample(time, state));
  }
  const deaths = detectSelfDeaths(samples, { duration: 60, gameplayEnd: 52 });
  assert.deepEqual(deaths.map(death => death.time), [20, 42]);
  assert.equal(deaths[0].end, 27);
  assert.equal(deaths[1].end, 46);
});

test('rejects intermittent cross-like flashes while the player remains alive', () => {
  const samples = [];
  for (let time = 0; time <= 45; time += 0.25) {
    const flash = time === 30 || (time >= 30.75 && time <= 31);
    samples.push(sample(time, flash ? 'cross' : 'alive'));
  }
  assert.deepEqual(detectSelfDeaths(samples, { duration: 45, gameplayEnd: 40 }), []);
});

function battleHudSample(time, teamDead = 1, enemyDead = 0, timerVisible = true) {
  const icon = dead => sample(time, dead ? 'cross' : 'unknown');
  return {
    time,
    timer: timerVisible
      ? { darkRatio: 0.45, whiteRatio: 0.1, edgeRatio: 0.1 }
      : { darkRatio: 0, whiteRatio: 0, edgeRatio: 0 },
    team: Array.from({ length: 4 }, (_, index) => icon(index < teamDead)),
    enemy: Array.from({ length: 4 }, (_, index) => icon(index < enemyDead)),
  };
}

test('detects player advantage, removes isolated flips, and holds through hidden HUD', () => {
  const samples = [];
  for (let time = 10; time < 18; time += 0.25) {
    const second = Math.floor(time);
    const isolatedFlip = second === 11;
    const timerVisible = second <= 12;
    samples.push(battleHudSample(time, isolatedFlip ? 2 : 1, 0, timerVisible));
  }

  const timeline = detectPlayerCounts(samples, { gameplayStart: 10, gameplayEnd: 17 });
  const at11 = timeline.find(state => state.time === 11.5);
  const at17 = timeline.find(state => state.time === 17.5);

  assert.deepEqual([at11.teamAlive, at11.enemyAlive, at11.difference], [3, 4, -1]);
  assert.equal(at17.source, 'held');
  assert.ok(at17.confidence < at11.confidence);
});

test('game count stabilization rejects impossible OCR jumps', () => {
  const samples = [
    { time: 10, left: [{ value: 100, cost: 0.04 }] },
    { time: 11, left: [{ value: 10, cost: 0.01 }, { value: 99, cost: 0.08 }] },
    { time: 12, left: [{ value: 98, cost: 0.07 }] },
    { time: 13, left: [] },
  ];
  const timeline = stabilizeGameCount(samples, 'left', { gameplayStart: 10, gameplayEnd: 13 });
  assert.deepEqual(timeline.map(item => item.value), [100, 99, 98, 98]);
  assert.equal(timeline.at(-1).source, 'held');
});

test('finds the yellow self marker only on a detailed result table', () => {
  const width = 960;
  const height = 540;
  const frame = Buffer.alloc(width * height * 3, 28);
  const paint = (left, top, boxWidth, boxHeight, color) => {
    for (let y = top; y < top + boxHeight; y += 1) {
      for (let x = left; x < left + boxWidth; x += 1) {
        const at = (y * width + x) * 3;
        frame[at] = color[0]; frame[at + 1] = color[1]; frame[at + 2] = color[2];
      }
    }
  };
  for (let y = 150; y < 510; y += 30) paint(500, y, 16, 30, [230, 230, 230]);
  paint(468, 404, 22, 22, [245, 195, 20]);
  const result = findSelfResultRow(frame);
  assert.ok(result);
  assert.equal(result.resultRows, 12);
  assert.equal(result.marker.x, 468);
  assert.equal(result.marker.y, 404);
});

test('selects an observed map frame inside a death review window', () => {
  const width = 960;
  const height = 540;
  const frame = Buffer.alloc(width * height * 3, 20);
  for (let y = 20; y < 520; y += 1) for (let x = 240; x < 720; x += 1) {
    const at = (y * width + x) * 3; frame[at] = 125; frame[at + 1] = 125; frame[at + 2] = 125;
  }
  const map = analyzeMapCandidate(frame, width, height, 12);
  const selected = selectObservedMapFrame([{ time: 3, neutralRatio: 0.02, edgeRatio: 0.01, score: 0.02 }, map], [{ time: 8 }]);
  assert.equal(selected.time, 12);
  assert.equal(selected.source, 'observed-map-screen');
});

test('removes only human-verified false death windows', () => {
  const deaths = [{ time: 35.5 }, { time: 95.25 }, { time: 123.25 }];
  assert.deepEqual(
    applyVerifiedDeathWindows(deaths, { ignoredDeathWindows: [[30, 45]] }).map(death => death.time),
    [95.25, 123.25],
  );
});

test('does not suppress the verified self death around 00:33', () => {
  const override = verifiedAnalysis('2026-08-08 15-20-32.mp4', 1);
  const deaths = [{ time: 33.25, evidence: { detector: 'self-hud-cross' } }];
  assert.deepEqual(applyVerifiedDeathWindows(deaths, override).map(death => death.time), [33.25]);
});

test('attaches respawn countdown evidence to the matching HUD death', () => {
  const [death] = attachRespawnEvidence(
    [{ time: 95, end: 101, confidence: 0.8, evidence: { detector: 'self-hud-cross' } }],
    [{ time: 100, confidence: 0.95, evidence: { detector: 'respawn-countdown-ui', variant: 'normal' } }],
  );
  assert.equal(death.evidence.respawn.detector, 'respawn-countdown-ui');
  assert.equal(death.evidence.timing.respawnUiDelay, 5);
  assert.equal(death.evidence.timing.timestampSource, 'self-hud-cross');
  assert.equal(death.time, 95);
  assert.equal(death.confidence, 0.95);
});

test('uses the first respawn UI frame when the self HUD was hidden', () => {
  const [death] = attachRespawnEvidence([], [
    { time: 42.25, end: 46, duration: 3.75, confidence: 0.94, type: 'death', title: '自分がデス', evidence: { detector: 'respawn-countdown-ui', variant: 'tacticooler' } },
  ]);
  assert.equal(death.time, 42.25);
  assert.equal(death.evidence.timing.timestampSource, 'respawn-ui-fallback');
  assert.equal(death.evidence.timing.hudDetectedAt, null);
});

test('uses earlier respawn evidence when the HUD cross appears after a map screen', () => {
  const [death] = attachRespawnEvidence(
    [{ time: 50, end: 56, confidence: 0.8, evidence: { detector: 'self-hud-cross' } }],
    [{ time: 48.5, end: 52, duration: 3.5, confidence: 0.94, type: 'death', title: '自分がデス', evidence: { detector: 'respawn-countdown-ui' } }],
  );
  assert.equal(death.time, 48.5);
  assert.equal(death.evidence.timing.timestampSource, 'respawn-ui-fallback');
  assert.equal(death.evidence.timing.respawnUiDelay, 0);
});
