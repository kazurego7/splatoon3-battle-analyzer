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
  assert.ok(segments[0].end <= 312, 'first match must stop before the next rule intro');
  assert.ok(segments[1].end <= duration, 'last match must stay inside the recording');
});
