import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySamples, detectMatchSegments, ruleIntroScore } from '../src/segmentation.mjs';

test('recognizes the rule card without confusing map, pose, logo, and XP screens', () => {
  const base = {
    difference: 40,
    saturation: 0.3,
    brightness: 100,
    hudWhiteRatio: 0,
    hudEdgeRatio: 0.02,
    centerWhiteRatio: 0.04,
    centerEdgeRatio: 0.13,
  };
  const samples = [
    { ...base, time: 0, centerDarkRatio: 0.275, centerWhiteRatio: 0.027 },
    { ...base, time: 2, centerDarkRatio: 0.204, saturation: 0.48 },
    { ...base, time: 4, centerDarkRatio: 0.397, saturation: 0.19 },
    { ...base, time: 6, centerDarkRatio: 0.319, saturation: 0.65 },
    { ...base, time: 8, centerDarkRatio: 0.388, saturation: 0.22 },
  ];

  const classified = classifySamples(samples, 2);
  assert.deepEqual(classified.map(sample => sample.ruleIntro), [true, false, false, false, false]);
});

test('recognizes a rule card over a bright stage without lowering the global threshold', () => {
  const frame = {
    centerDarkRatio: 0.22,
    centerWhiteRatio: 0.19,
    centerEdgeRatio: 0.17,
    saturation: 0.36,
  };
  assert.equal(ruleIntroScore(frame), 0.9);
});

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
  assert.equal(segments[0].end, 337, 'first match must retain the personal result search window and stop before the next intro');
  assert.equal(segments[1].end, 640, 'final match must retain the available personal result search window');
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
