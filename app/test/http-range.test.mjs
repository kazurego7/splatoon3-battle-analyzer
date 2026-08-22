import test from 'node:test';
import assert from 'node:assert/strict';
import { parseByteRange } from '../src/http-range.mjs';

test('通常・開放端・末尾のHTTP Rangeを解釈する', () => {
  assert.deepEqual(parseByteRange('bytes=0-999', 5000), { start: 0, end: 999 });
  assert.deepEqual(parseByteRange('bytes=1000-', 5000), { start: 1000, end: 4999 });
  assert.deepEqual(parseByteRange('bytes=-500', 5000), { start: 4500, end: 4999 });
  assert.deepEqual(parseByteRange('bytes=4500-9000', 5000), { start: 4500, end: 4999 });
});

test('不正または範囲外のHTTP Rangeを拒否する', () => {
  assert.equal(parseByteRange(null, 5000), null);
  for (const value of ['bytes=-', 'bytes=5000-', 'bytes=20-10', 'items=0-10', 'bytes=0-1,4-5']) {
    assert.equal(parseByteRange(value, 5000), false);
  }
});
