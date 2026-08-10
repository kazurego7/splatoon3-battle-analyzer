import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeOutcomeFrame, consolidateOutcomeObservations } from '../src/outcome-analysis.mjs';

const WIDTH = 960;
const HEIGHT = 540;

function frameWithTitle(firstLetter) {
  const frame = Buffer.alloc(WIDTH * HEIGHT * 3);
  const fill = (left, top, width, height) => {
    for (let y = top; y < top + height; y += 1) {
      for (let x = left; x < left + width; x += 1) {
        const at = (y * WIDTH + x) * 3;
        frame[at] = 255;
        frame[at + 1] = 255;
        frame[at + 2] = 255;
      }
    }
  };
  if (firstLetter === 'W') {
    fill(28, 25, 7, 34);
    fill(58, 25, 7, 34);
    fill(28, 52, 37, 8);
  } else {
    fill(28, 25, 8, 38);
    fill(28, 55, 24, 8);
  }
  for (const x of [68, 95, 122]) {
    fill(x, 25, 8, 38);
    fill(x, 25, 24, 8);
    fill(x, 55, 24, 8);
  }
  return frame;
}

test('distinguishes the post-match WIN and LOSE title by its first glyph', () => {
  assert.equal(analyzeOutcomeFrame(frameWithTitle('W'), WIDTH, HEIGHT, 10)?.value, 'win');
  assert.equal(analyzeOutcomeFrame(frameWithTitle('L'), WIDTH, HEIGHT, 10)?.value, 'lose');
});

test('requires repeated outcome announcement observations', () => {
  const win = { value: 'win', time: 10, confidence: 0.9, evidence: 'test' };
  const lose = { value: 'lose', time: 11, confidence: 0.9, evidence: 'test' };
  assert.equal(consolidateOutcomeObservations([win]), null);
  assert.equal(consolidateOutcomeObservations([win, win, lose]), null);
  assert.equal(consolidateOutcomeObservations([win, win, win, lose])?.value, 'win');
});
