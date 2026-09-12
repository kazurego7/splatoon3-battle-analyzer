import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSegmentList } from '../src/live-media-session.mjs';

test('segment list preserves absolute recording times', () => {
  assert.deepEqual(parseSegmentList([
    '"segment-000000.mp4",0.000000,6.006000',
    '"segment-000001.mp4",6.006000,12.012000',
  ].join('\n')), [
    { fileName: 'segment-000000.mp4', start: 0, end: 6.006, duration: 6.006 },
    { fileName: 'segment-000001.mp4', start: 6.006, end: 12.012, duration: 6.006 },
  ]);
});

test('invalid segment list rows are ignored', () => {
  assert.deepEqual(parseSegmentList('bad\n"segment.mp4",5,4\n'), []);
});
