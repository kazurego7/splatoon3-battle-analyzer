import test from 'node:test';
import assert from 'node:assert/strict';
import { detectRespawnRuns } from '../src/respawn-vision.mjs';

function observation(time, detected = true) {
  return {
    time,
    kind: 'tacticooler',
    score: detected ? 0.8 : 0.2,
    whiteScore: detected ? 0.7 : 0.1,
    fineWhiteScore: detected ? 0.65 : 0.1,
  };
}

test('rejects short and intermittent respawn-like false positives', () => {
  const samples = [];
  for (let time = 10; time <= 40; time += 0.25) {
    const openingText = time >= 17.5 && time <= 20.5 && Number.isInteger((time - 17.5) / 0.75);
    const briefInkMatch = time >= 24 && time <= 24.25;
    const realCountdown = time >= 30 && time <= 33.5;
    samples.push(observation(time, openingText || briefInkMatch || realCountdown));
  }

  const deaths = detectRespawnRuns(samples, { gameplayEnd: 40 });
  assert.deepEqual(deaths.map(death => death.time), [30]);
  assert.equal(deaths[0].evidence.consecutiveObservations, 15);
});

test('keeps a countdown when a brief visual obstruction interrupts it', () => {
  const samples = [];
  for (let time = 10; time <= 30; time += 0.25) {
    const countdown = time >= 20 && time <= 23.5 && !(time >= 22.25 && time <= 22.5);
    samples.push(observation(time, countdown));
  }

  const [death] = detectRespawnRuns(samples, { gameplayEnd: 30 });
  assert.equal(death.time, 20);
  assert.equal(death.evidence.observations, 13);
  assert.equal(death.evidence.consecutiveObservations, 9);
});
