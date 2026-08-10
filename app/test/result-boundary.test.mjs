import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseResultBoundary, refineResultBoundaries } from '../src/result-boundary.mjs';

test('overall result is preferred over an earlier personal result', () => {
  const boundary = chooseResultBoundary([
    { time: 310, screenType: 'personal' },
    { time: 311, screenType: 'personal' },
    { time: 326, screenType: 'overall' },
    { time: 327, screenType: 'overall' },
  ], { fallbackEnd: 337, searchEnd: 339.75, interval: 1 });
  assert.equal(boundary.end, 328.25);
  assert.equal(boundary.resultBoundary.screenType, 'overall');
  assert.equal(boundary.resultBoundary.detection, 'overall-result-priority');
});

test('personal result is the fallback when no overall result is displayed', () => {
  const boundary = chooseResultBoundary([
    { time: 292, screenType: 'personal' },
    { time: 294, screenType: 'personal' },
  ], { fallbackEnd: 337, searchEnd: 339.75, interval: 1 });
  assert.equal(boundary.end, 295.25);
  assert.equal(boundary.resultBoundary.screenType, 'personal');
  assert.equal(boundary.resultBoundary.detection, 'personal-result-fallback');
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
    if (start === 288) return [
      options.onFrame(Buffer.alloc(0), 960, 540, 315),
      { time: 326, screenType: 'overall' },
    ];
    return [];
  };
  // Avoid invoking the real frame classifier for the synthetic empty frame.
  const segments = await refineResultBoundaries('raw.mp4', [
    { start: 22, activeEnd: 300, end: 337 },
    { start: 340, activeEnd: 590, end: 640 },
  ], 640, { sampler });
  assert.deepEqual(calls, [
    { source: 'raw.mp4', start: 288, end: 339.75, interval: 1 },
    { source: 'raw.mp4', start: 578, end: 640, interval: 1 },
    { source: 'raw.mp4', start: 578, end: 640, interval: 0.25 },
  ]);
  assert.equal(segments[0].end, 327.25);
  assert.equal(segments[1].end, 640);
});
