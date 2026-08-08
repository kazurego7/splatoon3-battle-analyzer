import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPlayerCounts, detectSelfDeaths } from '../src/battle-analysis.mjs';
import { stabilizeGameCount } from '../src/game-count-vision.mjs';

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
