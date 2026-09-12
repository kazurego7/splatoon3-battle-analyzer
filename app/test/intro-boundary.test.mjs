import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseIntroBoundary, refineIntroBoundaries } from '../src/intro-boundary.mjs';

const nonRule = time => ({ time, centerDarkRatio: 1, centerWhiteRatio: 0, centerEdgeRatio: 0, saturation: 0 });
const rule = time => ({ time, centerDarkRatio: 0.26, centerWhiteRatio: 0.04, centerEdgeRatio: 0.13, saturation: 0.3 });

test('chooses the first frame of a stable rule-card run', () => {
  assert.equal(chooseIntroBoundary([nonRule(969), nonRule(970), rule(971), rule(972), rule(973)]), 971);
});

test('skips the ink-reveal frame and keeps an already settled full card', () => {
  const revealing = { ...rule(21), centerDarkRatio: 0.259, saturation: 0.297 };
  const full = { ...rule(22), centerDarkRatio: 0.256, saturation: 0.364 };
  const next = { ...rule(23), centerDarkRatio: 0.255, saturation: 0.363 };
  assert.equal(chooseIntroBoundary([revealing, full, next]), 22);

  const settled = { ...rule(1471), centerDarkRatio: 0.274, saturation: 0.268 };
  const settledNext = { ...rule(1472), centerDarkRatio: 0.262, saturation: 0.301 };
  assert.equal(chooseIntroBoundary([settled, settledNext, rule(1473)]), 1471);
});

test('rejects a single rule-like flash', () => {
  assert.equal(chooseIntroBoundary([nonRule(10), rule(11), nonRule(12), nonRule(13)]), null);
});

test('refines every coarse start on the original recording timeline', async () => {
  const segments = [{ start: 970, activeStart: 970, activeEnd: 1306, end: 1328 }];
  const sampler = async (_source, start, end) => {
    assert.equal(start, 968);
    assert.equal(end, 974);
    return [nonRule(968), nonRule(969), nonRule(970.5), rule(971), rule(971.5), rule(972)];
  };
  const [refined] = await refineIntroBoundaries('recording.mp4', segments, 2081, { sampler });
  assert.equal(refined.start, 971);
  assert.equal(refined.activeStart, 971);
  assert.equal(refined.introBoundary.detection, 'one-second-stable-rule-card');
});
