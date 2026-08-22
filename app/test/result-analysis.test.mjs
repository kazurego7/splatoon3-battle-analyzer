import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseDeathCandidateSet, detectResultScreen, reconcileDeathsWithResult } from '../src/result-analysis.mjs';

function death(time, { respawn = false, confidence = 0.9 } = {}) {
  return {
    id: 'candidate',
    time,
    confidence,
    evidence: respawn
      ? { detector: 'respawn-countdown-ui', consecutiveObservations: 14 }
      : { detector: 'self-hud-cross' },
  };
}

test('uses the result death count and prefers respawn-confirmed candidates', () => {
  const deaths = reconcileDeathsWithResult([
    death(35, { confidence: 0.99 }),
    death(124.5, { respawn: true, confidence: 0.94 }),
    death(199, { confidence: 0.99 }),
    death(243, { respawn: true, confidence: 0.95 }),
  ], 2);
  assert.deepEqual(deaths.map(item => item.time), [124.5, 243]);
  assert.deepEqual(deaths.map(item => item.id), ['death-1', 'death-2']);
});

test('returns no deaths when the result count is unavailable', () => {
  assert.deepEqual(reconcileDeathsWithResult([death(20)], null), []);
});

test('publishes confirmed partial deaths when candidates are fewer than the result count', () => {
  assert.deepEqual(reconcileDeathsWithResult([death(20, { respawn: true })], 2).map(item => item.time), [20]);
});

test('chooses the exact-count HUD slot with the most respawn confirmations', () => {
  const selected = chooseDeathCandidateSet([
    { slot: 0, deaths: [death(10), death(20, { respawn: true })] },
    { slot: 3, deaths: [death(11, { respawn: true }), death(21, { respawn: true })] },
  ], 2, 0);
  assert.equal(selected.slot, 3);
  assert.equal(selected.respawnConfirmed, 2);
});

test('detects a personal result whose stage banner is mostly dark', () => {
  const width = 960;
  const height = 540;
  const frame = new Uint8Array(width * height * 3).fill(100);
  const paint = (left, top, regionWidth, regionHeight, colorAt) => {
    for (let y = top; y < top + regionHeight; y += 1) {
      for (let x = left; x < left + regionWidth; x += 1) {
        const color = colorAt(x, y);
        const at = (y * width + x) * 3;
        frame[at] = color;
        frame[at + 1] = color;
        frame[at + 2] = color;
      }
    }
  };
  paint(390, 105, 530, 405, (x, y) => ((x >> 1) + (y >> 1)) % 5 ? 20 : 100);
  paint(430, 370, 455, 120, (x, y) => ((x >> 1) + (y >> 1)) % 4 ? 20 : 230);
  paint(390, 15, 535, 90, (x, y) => ((x >> 1) + (y >> 1)) % 8 ? 20 : 230);

  const result = detectResultScreen(frame, 100);
  assert.equal(result?.screenType, 'personal');
});
