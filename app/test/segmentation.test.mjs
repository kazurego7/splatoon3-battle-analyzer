import test from 'node:test';
import assert from 'node:assert/strict';
import { detectMatchSegments } from '../src/segmentation.mjs';

test('rule intro clusters split consecutive matches', () => {
  const interval = 2;
  const duration = 640;
  const samples = [];
  for (let time = 0; time < duration; time += interval) {
    const inFirstMatch = time >= 22 && time < 300;
    const inSecondMatch = time >= 340 && time < 590;
    const ruleIntro = time === 22 || time === 24 || time === 340 || time === 342;
    samples.push({
      time,
      gameplay: inFirstMatch || inSecondMatch,
      ruleIntro,
      ruleScore: ruleIntro ? 0.95 : 0,
    });
  }

  const segments = detectMatchSegments(samples, duration, interval);
  assert.equal(segments.length, 2);
  assert.deepEqual(segments.map(segment => segment.start), [22, 340]);
  assert.equal(segments[0].end, 337, 'first match must retain results and stop just before the next rule intro');
  assert.equal(segments[1].end, 640, 'final match must retain the available post-match result sequence');
  assert.ok(segments[1].end <= duration, 'last match must stay inside the recording');
});

test('keeps low-HUD matches and prefers the real intro after a power result', () => {
  const samples = Array.from({ length: 320 }, (_, index) => ({
    time: index * 2,
    gameplay: false,
    active: (index >= 21 && index <= 90) || (index >= 121 && index <= 200) || index >= 230,
    ruleIntro: false,
    ruleScore: 0,
  }));
  // 200s is a result/power card; 242s is the actual next rule intro.
  for (const [time, score] of [[42, 1], [200, 0.92], [242, 1], [460, 1]]) {
    const sample = samples.find(item => item.time === time);
    sample.ruleIntro = true;
    sample.ruleScore = score;
  }
  const segments = detectMatchSegments(samples, 640, 2);
  assert.deepEqual(segments.map(segment => segment.start), [42, 242, 460]);
});
