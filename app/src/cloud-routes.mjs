import { publicError } from './r2-api.mjs';
import { appDataUrl } from '../public/app-path.js';
import { sendBody } from './http-performance.mjs';

export function localCloudRequest(request, url) {
  return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress)
    && !request.headers['tailscale-user-login']
    && (!request.headers.origin || request.headers.origin === url.origin)
    && !['cross-site', 'same-site'].includes(request.headers['sec-fetch-site']);
}
export function transferControlRequest(request, url) {
  if (localCloudRequest(request, url)) return true;
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress)
    && Boolean(request.headers['tailscale-user-login']) && url.hostname.endsWith('.ts.net')
    && (!request.headers.origin || request.headers.origin === `https://${url.host}`)
    && !['cross-site', 'same-site'].includes(request.headers['sec-fetch-site']);
}
async function readBody(request) {
  let body = '';
  for await (const chunk of request) { body += chunk; if (body.length > 16384) throw new Error('Request too large'); }
  return JSON.parse(body || '{}');
}
export async function cloudRoute(request, response, url, service) {
  if (!/^\/api\/cloud(?:\/|$)/.test(url.pathname)) return false;
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Referrer-Policy', 'no-referrer');
  const json = (status, body) => { sendBody(request, response, JSON.stringify(body, (_, value) => appDataUrl(value, response.appBasePath || '')), 'application/json; charset=utf-8', { status, cache: 'no-store' }); return true; };
  const parts = url.pathname.split('/').filter(Boolean);
  try {
    if (request.method === 'GET' && parts.length === 2) return json(200, { ...service.summary(), canConfigure: localCloudRequest(request, url), canControlTransfer: transferControlRequest(request, url) });
    if (request.method === 'POST') {
      if (parts.length === 3 && parts[2] === 'transfer') {
        if (!transferControlRequest(request, url)) return json(403, { error: '転送の操作は自宅PCまたはTailscaleから行ってください。' });
        const body = await readBody(request);
        if (typeof body.paused !== 'boolean') return json(400, { error: '一時停止または再開を指定してください。' });
        return json(200, await service.setPaused(body.paused));
      }
      if (!localCloudRequest(request, url)) return json(403, { error: 'R2の設定・再試行は自宅PCのlocalhostから操作してください。' });
      if (parts.length === 3 && parts[2] === 'config') { await service.configure(await readBody(request)); return json(200, { ok: true }); }
      if (parts.length === 4) { await service.retry(decodeURIComponent(parts[2]), Number(parts[3])); return json(202, { ok: true }); }
    }
    if (request.method === 'GET' && parts.length >= 4) {
      const id = decodeURIComponent(parts[2]), number = Number(parts[3]);
      if (parts.length === 5 && parts[4] === 'play') {
        const location = await service.playbackUrl(id, number);
        // Only this small redirect traverses the home connection. R2 serves the bytes and ranges.
        response.writeHead(307, { Location: location }); response.end(); return true;
      }
      if (parts.length === 4) {
        const { recording, match } = service.find(id, number);
        return json(200, service.publicJob(service.currentJob(recording, match)));
      }
    }
    return json(404, { error: 'ページが見つかりません。' });
  } catch (error) { return json(400, { error: publicError(error) }); }
}
