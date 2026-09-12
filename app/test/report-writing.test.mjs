import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCodexPatterns } from '../src/codex-death-analysis.mjs';

test('internal death links remain intact while all report prose uses player-facing names', () => {
  const report = normalizeCodexPatterns({ overallSummary: 'death-1で後退した', patterns: [{
    id: 'pattern-1', title: 'death-1とdeath-3の後退', summary: 'death-1で被弾',
    trigger: 'death-3で接近', repeatedAction: 'death-1で前進', consequence: 'death-3で脱落',
    reviewFocus: 'death-1を確認', deathIds: ['death-1', 'death-3'],
    clips: ['death-1', 'death-3'].map(deathId => ({ deathId, startOffset: -5, endOffset: 1, label: deathId, reason: `${deathId}の後退` })),
  }] }, new Set(['death-1', 'death-3']));
  assert.equal(report.overallSummary, 'デス1回目で後退した');
  const pattern = report.patterns[0];
  assert.deepEqual(pattern.deathIds, ['death-1', 'death-3']);
  assert.equal(pattern.clips[0].deathId, 'death-1');
  for (const field of ['title', 'summary', 'trigger', 'repeatedAction', 'consequence', 'reviewFocus']) assert.doesNotMatch(pattern[field], /death-\d+/);
  assert.equal(pattern.clips[1].reason, 'デス3回目の後退');
});
