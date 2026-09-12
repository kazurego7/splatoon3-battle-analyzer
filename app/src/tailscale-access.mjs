import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export function tailscaleRemoteUrl(status) {
  const dnsName = String(status?.Self?.DNSName || '').replace(/\.$/, '');
  return dnsName ? `https://${dnsName}/sba/` : null;
}

export async function configureTailscaleServe(port, { execute = execFileAsync } = {}) {
  const command = process.platform === 'win32' ? 'tailscale.exe' : 'tailscale';
  // Serve strips the mount path; adding it to the upstream preserves the app's base path.
  // Only /sba is configured, leaving other apps on this host intact.
  await execute(command, ['serve', '--bg', '--yes', '--set-path=/sba', `http://127.0.0.1:${port}/sba`], { windowsHide: true });
  const { stdout } = await execute(command, ['status', '--json'], { windowsHide: true });
  const url = tailscaleRemoteUrl(JSON.parse(stdout));
  if (!url) throw new Error('Tailscaleのホスト名を取得できませんでした');
  return url;
}
