import test from 'node:test';
import assert from 'node:assert/strict';
import { mapWithConcurrency, positiveConcurrency } from '../src/concurrency.mjs';

test('bounded mapping retains input order while running work concurrently', async () => {
  let active = 0;
  let maximumActive = 0;
  const result = await mapWithConcurrency([30, 5, 15, 1], 2, async (delay, index) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise(resolve => setTimeout(resolve, delay));
    active -= 1;
    return index;
  });
  assert.deepEqual(result, [0, 1, 2, 3]);
  assert.equal(maximumActive, 2);
});

test('concurrency configuration is clamped to a safe range', () => {
  assert.equal(positiveConcurrency('3', 2), 3);
  assert.equal(positiveConcurrency('99', 2), 4);
  assert.equal(positiveConcurrency('invalid', 2), 2);
  assert.equal(positiveConcurrency('0', 2), 2);
});
