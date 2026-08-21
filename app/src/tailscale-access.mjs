import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export function tailscaleRemoteUrl(status) {
  const dnsName = String(status?.Self?.DNSName || '').replace(/\.$/, '');
  return dnsName ? `https://${dnsName}/` : null;
}

export async function configureTailscaleServe(port, { execute = execFileAsync } = {}) {
  const command = process.platform === 'win32' ? 'tailscale.exe' : 'tailscale';
  await execute(command, ['serve', '--bg', '--yes', String(port)], { windowsHide: true });
  const { stdout } = await execute(command, ['status', '--json'], { windowsHide: true });
  const url = tailscaleRemoteUrl(JSON.parse(stdout));
  if (!url) throw new Error('Tailscaleのホスト名を取得できませんでした');
  return url;
}
