import test from 'node:test';
import assert from 'node:assert/strict';
import { deathAnalysisEndpoint, deathSeekTime, deathSequenceFor } from '../public/death-analysis-ui.js';

test('death list keeps the existing eight-second pre-roll', () => {
  assert.equal(deathSeekTime({ time: 38.25 }), 30.25);
  assert.equal(deathSeekTime({ time: 3 }), 0);
});

test('sequence steps seek relative to the death and stay within the video', () => {
  assert.equal(deathSeekTime({ time: 38.25 }, -2), 36.25);
  assert.equal(deathSeekTime({ time: 38.25 }, 1, 38.5), 38.5);
});

test('sequence and endpoint helpers support stored and root analysis data', () => {
  const stored = [{ offset: -8 }], root = [{ offset: -4 }];
  assert.equal(deathSequenceFor({ deathAnalysis: { sequences: [{ id: 'd1', sequence: root }] } }, { id: 'd1', sequence: stored }), stored);
  assert.equal(deathSequenceFor({ deathAnalysis: { sequences: [{ id: 'd1', sequence: root }] } }, { id: 'd1' }), root);
  assert.equal(deathAnalysisEndpoint('/api/analysis/r1/match-01.json?x=1'), '/api/analysis/r1/match-01.json/ai-death-sequence');
});
