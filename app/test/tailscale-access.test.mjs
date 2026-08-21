import test from 'node:test';
import assert from 'node:assert/strict';
import { tailscaleRemoteUrl } from '../src/tailscale-access.mjs';

test('Tailscale DNS名をHTTPSのリモートURLにする', () => {
  assert.equal(
    tailscaleRemoteUrl({ Self: { DNSName: 'pc-win.example.ts.net.' } }),
    'https://pc-win.example.ts.net/',
  );
});

test('DNS名がない場合はリモートURLを作らない', () => {
  assert.equal(tailscaleRemoteUrl({ Self: {} }), null);
});
