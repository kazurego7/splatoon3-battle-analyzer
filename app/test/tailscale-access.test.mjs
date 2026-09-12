import test from 'node:test';
import assert from 'node:assert/strict';
import { tailscaleRemoteUrl, configureTailscaleServe } from '../src/tailscale-access.mjs';

test('Tailscale DNS名をHTTPSのリモートURLにする', () => {
  assert.equal(
    tailscaleRemoteUrl({ Self: { DNSName: 'pc-win.example.ts.net.' } }),
    'https://pc-win.example.ts.net/sba/',
  );
});

test('Serve mounts only /sba and restores the prefix stripped by the proxy', async () => {
  const calls = [];
  const url = await configureTailscaleServe(4310, { execute: async (command, args, options) => {
    calls.push({ command, args, options });
    return { stdout: args[0] === 'status' ? JSON.stringify({ Self: { DNSName: 'pc.example.ts.net.' } }) : '' };
  } });
  assert.equal(url, 'https://pc.example.ts.net/sba/');
  assert.deepEqual(calls[0].args, ['serve', '--bg', '--yes', '--set-path=/sba', 'http://127.0.0.1:4310/sba']);
  assert.equal(calls[0].options.windowsHide, true);
  assert.equal(calls.some(call => call.args.includes('reset') || call.args.includes('funnel')), false);
});

test('DNS名がない場合はリモートURLを作らない', () => {
  assert.equal(tailscaleRemoteUrl({ Self: {} }), null);
});
