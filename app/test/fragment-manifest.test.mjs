import test from 'node:test';
import assert from 'node:assert/strict';
import { selectMatchFragments } from '../src/fragment-manifest.mjs';

const segments = [
  { fileName: 'a.mp4', start: 0, end: 6, duration: 6 },
  { fileName: 'b.mp4', start: 6, end: 12, duration: 6 },
  { fileName: 'c.mp4', start: 12, end: 18, duration: 6 },
];

test('fragment manifest trims a match without creating another video', () => {
  const manifest = selectMatchFragments(segments, { start: 4.25, end: 14.5, urlFor: item => `/media/${item.fileName}` });
  assert.equal(manifest.playbackStart, 4.25);
  assert.equal(manifest.playbackEnd, 14.5);
  assert.equal(manifest.duration, 10.25);
  assert.deepEqual(manifest.fragments.map(item => item.url), ['/media/a.mp4', '/media/b.mp4', '/media/c.mp4']);
});

test('fragment manifest chooses only overlapping fragments', () => {
  const manifest = selectMatchFragments(segments, { start: 6, end: 12, codec: 'h264' });
  assert.equal(manifest.codec, 'h264');
  assert.deepEqual(manifest.fragments.map(item => item.url), ['b.mp4']);
  assert.equal(manifest.playbackStart, 0);
  assert.equal(manifest.playbackEnd, 6);
});
