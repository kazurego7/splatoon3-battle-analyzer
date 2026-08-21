import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseResultBoundary, refineResultBoundaries } from '../src/result-boundary.mjs';

test('only a stable personal result determines the boundary', () => {
  const boundary = chooseResultBoundary([
    { time: 310, screenType: 'personal' },
    { time: 311, screenType: 'personal' },
  ], { fallbackEnd: 337, searchEnd: 339.75, interval: 1 });
  assert.equal(boundary.end, 312.25);
  assert.equal(boundary.resultBoundary.screenType, 'personal');
  assert.equal(boundary.resultBoundary.detection, 'stable-personal-result');
});

test('personal result alone determines the boundary', () => {
  const boundary = chooseResultBoundary([
    { time: 292, screenType: 'personal' },
    { time: 293, screenType: 'personal' },
  ], { fallbackEnd: 337, searchEnd: 339.75, interval: 1 });
  assert.equal(boundary.end, 294.25);
  assert.equal(boundary.resultBoundary.screenType, 'personal');
  assert.equal(boundary.resultBoundary.detection, 'stable-personal-result');
});

test('a single personal observation is not sufficient', () => {
  const boundary = chooseResultBoundary([
    { time: 292, screenType: 'personal' },
  ], { fallbackEnd: 337, searchEnd: 339.75, interval: 1 });
  assert.equal(boundary.end, 337);
  assert.equal(boundary.resultBoundary.detection, 'heuristic-fallback');
});

test('heuristic end remains when neither result screen is detected', () => {
  const boundary = chooseResultBoundary([
    { time: 292, screenType: null },
  ], { fallbackEnd: 337, searchEnd: 339.75, interval: 1 });
  assert.equal(boundary.end, 337);
  assert.equal(boundary.resultBoundary.detection, 'heuristic-fallback');
});

test('refinement scans absolute post-match time and keeps per-match fallback', async () => {
  const calls = [];
  const sampler = async (source, start, end, options) => {
    calls.push({ source, start, end, interval: options.interval });
    if (start === 247) return [
      { time: 316, screenType: 'personal' },
      { time: 317, screenType: 'personal' },
    ];
    return [];
  };
  // Avoid invoking the real frame classifier for the synthetic empty frame.
  const segments = await refineResultBoundaries('raw.mp4', [
    { start: 22, activeEnd: 300, end: 337 },
    { start: 340, activeEnd: 590, end: 640 },
  ], 640, { sampler });
  assert.deepEqual(calls, [
    { source: 'raw.mp4', start: 247, end: 339.75, interval: 1 },
    { source: 'raw.mp4', start: 550, end: 640, interval: 1 },
    { source: 'raw.mp4', start: 550, end: 640, interval: 0.25 },
  ]);
  assert.equal(segments[0].end, 318.25);
  assert.equal(segments[1].end, 640);
});
