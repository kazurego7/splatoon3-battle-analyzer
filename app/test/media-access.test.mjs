import test from 'node:test';
import assert from 'node:assert/strict';
import { isLoopbackHostname, isRemoteAccess, preferredRemoteCodec, remoteVideoApiUrl, remoteVideoMediaUrl } from '../public/media-access.js';

test('localhostとループバックだけをローカル閲覧として扱う', () => {
  for (const hostname of ['localhost', '127.0.0.1', '::1', '[::1]']) assert.equal(isLoopbackHostname(hostname), true);
  for (const hostname of ['pc.example.ts.net', '100.64.0.10', '192.168.1.20']) assert.equal(isLoopbackHostname(hostname), false);
  assert.equal(isRemoteAccess({ hostname: 'localhost' }), false);
  assert.equal(isRemoteAccess({ hostname: 'pc.example.ts.net' }), true);
});

test('試合動画URLをネットワーク用APIと動画URLへ安全に変換する', () => {
  const source = '/media/matches/recording%201/match-01.mp4';
  assert.equal(remoteVideoApiUrl(source), '/api/remote-video/recording%201/match-01.mp4?codec=h264');
  assert.equal(remoteVideoApiUrl(source, 'hevc'), '/api/remote-video/recording%201/match-01.mp4?codec=hevc');
  assert.equal(remoteVideoMediaUrl(source), '/media/remote-matches/h264/recording%201/match-01.mp4');
  assert.equal(remoteVideoMediaUrl(source, 'hevc'), '/media/remote-matches/hevc/recording%201/match-01.mp4');
  assert.equal(remoteVideoApiUrl('/assets/example.mp4'), null);
});

test('ブラウザがHEVCを再生できる場合だけHEVCを選ぶ', () => {
  assert.equal(preferredRemoteCodec({ canPlayType:()=> 'probably' }), 'hevc');
  assert.equal(preferredRemoteCodec({ canPlayType:()=> 'maybe' }), 'hevc');
  assert.equal(preferredRemoteCodec({ canPlayType:()=> '' }), 'h264');
  assert.equal(preferredRemoteCodec(null), 'h264');
});
