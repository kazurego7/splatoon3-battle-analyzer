import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveOutcomeLabel } from '../public/outcome.js';

test('uses the post-match announcement before a contradictory count fallback', () => {
  assert.equal(resolveOutcomeLabel({
    outcome: { value: 'win' },
    gameFlow: { gameCounts: [{ teamCount: 100, enemyCount: 1 }] },
  }), 'WIN');
  assert.equal(resolveOutcomeLabel({
    outcome: { value: 'lose' },
    gameFlow: { gameCounts: [{ teamCount: 1, enemyCount: 100 }] },
  }), 'LOSE');
});

test('keeps the count comparison only as a compatibility fallback', () => {
  assert.equal(resolveOutcomeLabel({ gameFlow: { gameCounts: [{ teamCount: 20, enemyCount: 50 }] } }), 'WIN');
  assert.equal(resolveOutcomeLabel({ gameFlow: { gameCounts: [{ teamCount: 60, enemyCount: 30 }] } }), 'LOSE');
  assert.equal(resolveOutcomeLabel({}), '未判定');
});
