import { configureTailscaleServe } from '../src/tailscale-access.mjs';

const port = Number(process.env.PORT || 4310);

try {
  const remoteUrl = await configureTailscaleServe(port);
  process.env.BATTLE_REVIEW_REMOTE_URL = remoteUrl;
  console.log(`Tailscale: ${remoteUrl}`);
} catch (error) {
  console.error(`Tailscale Serveを設定できませんでした: ${error.message}`);
  console.error('Tailscaleが起動・ログイン済みか確認してください。ローカル起動は継続します。');
}

await import('../src/server.mjs');
