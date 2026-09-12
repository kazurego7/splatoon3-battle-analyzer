import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createMatchThumbnail } from '../src/match-thumbnail.mjs';

test('creates a thumbnail from the preserved recording at a time inside the match', async () => {
  const calls = [];
  const url = await createMatchThumbnail({
    recording: { id: 'recording 1', source: 'source.mp4' },
    match: { number: 2, start: 100, end: 220 },
    thumbnailRoot: path.join('data', 'thumbnails'),
    extractor: async (...args) => { calls.push(args); },
  });

  assert.equal(url, '/media/thumbnails/recording%201/match-02.jpg');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'source.mp4');
  assert.equal(calls[0][1], 135);
  assert.equal(calls[0][2], path.join('data', 'thumbnails', 'recording 1', 'match-02.jpg'));
  assert.equal(calls[0][3], 640);
});
