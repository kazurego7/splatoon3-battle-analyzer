import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSelfDeaths } from '../src/battle-analysis.mjs';

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
