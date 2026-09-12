import test from 'node:test';
import assert from 'node:assert/strict';
import { mediaController } from '../public/media-player.js';

class Video extends EventTarget {
  constructor() { super(); this.currentTime = 0; this.paused = true; this.src = ''; this.loads = 0; }
  play() { this.paused = false; this.dispatchEvent(new Event('play')); this.dispatchEvent(new Event('playing')); return Promise.resolve(); }
  pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
  load() { this.loads++; }
  removeAttribute(name) { if (name === 'src') this.src = ''; }
}
test('native report player uses match-relative time and keeps native controls and events', async () => {
  const video = new Video(), media = mediaController(video, { offset: 20, controls: true });
  media.src = '/media/recordings/a/source.mp4'; media.currentTime = 3;
  assert.equal(video.currentTime, 23); assert.equal(media.currentTime, 3); assert.equal(video.controls, true);
  await media.play(); assert.equal(video.paused, false); media.pause(); assert.equal(video.paused, true);
});
test('expired cloud redirect renews once, preserves seek and playback, and never falls back locally', async t => {
  let now = 100000; t.mock.method(Date, 'now', () => now);
  const video = new Video(), media = mediaController(video); media.src = '/api/cloud/r1/1/play'; media.currentTime = 12; await media.play();
  now += 86400000; video.error = { code: 2 }; video.dispatchEvent(new Event('error'));
  assert.match(video.src, /^\/api\/cloud\/r1\/1\/play\?renew=/); assert.equal(video.loads, 1);
  video.currentTime = 0; video.error = null; video.dispatchEvent(new Event('loadedmetadata'));
  assert.equal(video.currentTime, 12); assert.equal(video.paused, false);
  video.dispatchEvent(new Event('error')); assert.equal(video.loads, 1);
});
test('changing videos cancels pending renewal seeks', async t => {
  let now = 100000; t.mock.method(Date, 'now', () => now);
  const video = new Video(), media = mediaController(video); media.src = '/api/cloud/r1/1/play'; media.currentTime = 12;
  now += 86400000; video.dispatchEvent(new Event('error'));
  media.removeAttribute('src'); media.src = '/media/matches/r2/clip.mp4'; video.currentTime = 0; video.dispatchEvent(new Event('loadedmetadata'));
  assert.equal(video.currentTime, 0); assert.equal(video.src, '/media/matches/r2/clip.mp4');
});
