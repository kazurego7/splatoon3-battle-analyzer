import test from 'node:test';
import assert from 'node:assert/strict';
import { imageSourceUrl, isLoopbackHostname, isRemoteAccess, playbackRecording, videoSourcePreference } from '../public/media-access.js';

test('remote live matches can use compressed fragments before R2, while local readiness is independent', () => {
  const ready = { number: 1, status: 'ready', sourceVideoUrl: '/media/recordings/1/source.mp4' };
  const recording = { live: true, status: 'recording', matches: [ready] };
  assert.equal(playbackRecording(recording, false).matches[0].status, 'ready');
  assert.equal(playbackRecording(recording, true).matches[0].status, 'cloud-pending');
  ready.videoManifest = { fragments: [{ url: '/media/live/1/segment.mp4' }] };
  assert.equal(playbackRecording(recording, true).matches[0].status, 'ready');
  recording.live = false;
  assert.equal(playbackRecording(recording, true).matches[0].status, 'cloud-pending');
  ready.cloud = { status: 'ready' };
  assert.equal(playbackRecording(recording, true).matches[0].status, 'ready');
});

test('localhostとループバックだけをローカル閲覧として扱う', () => {
  for (const hostname of ['localhost', '127.0.0.1', '::1', '[::1]']) assert.equal(isLoopbackHostname(hostname), true);
  for (const hostname of ['pc.example.ts.net', '100.64.0.10', '192.168.1.20']) assert.equal(isLoopbackHostname(hostname), false);
  assert.equal(isRemoteAccess({ hostname: 'localhost' }), false);
  assert.equal(isRemoteAccess({ hostname: 'pc.example.ts.net' }), true);
});

test('現行の再生先だけを採用し、旧設定・不明な値は自動判定に戻す', t => {
  let saved;
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => saved } });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  });
  for (saved of [null, 'youtube', 'unknown']) {
    assert.equal(videoSourcePreference(), 'auto');
    assert.equal(isRemoteAccess({ hostname: 'localhost' }), false);
    assert.equal(isRemoteAccess({ hostname: 'pc.example.ts.net' }), true);
  }
  saved = 'cloud';
  assert.equal(videoSourcePreference(), 'cloud');
  assert.equal(isRemoteAccess({ hostname: 'localhost' }), true);
  assert.equal(imageSourceUrl('/assets/stage.webp', 'icon'), '/assets/stage.webp?size=icon');
  assert.equal(imageSourceUrl('/media/thumb.jpg?v=2', 'list'), '/media/thumb.jpg?v=2&size=list');
  saved = 'local';
  assert.equal(videoSourcePreference(), 'local');
  assert.equal(isRemoteAccess({ hostname: 'pc.example.ts.net' }), false);
  assert.equal(imageSourceUrl('/assets/stage.webp', 'icon'), '/assets/stage.webp');
  assert.equal(imageSourceUrl('/media/thumb.jpg?v=2', 'list'), '/media/thumb.jpg?v=2');
});
