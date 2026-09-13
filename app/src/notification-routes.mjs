import { sendBody } from './http-performance.mjs';

export async function notificationRoute(request, response, url, service) {
  if (url.pathname !== '/api/notifications') return false;
  const reply = (status, body) => { sendBody(request, response, JSON.stringify(body), 'application/json; charset=utf-8', { status, cache: 'no-store' }); return true; };
  if (request.method === 'GET') return reply(200, { publicKey: service.state.keys.publicKey });
  const origin = `${request.headers['tailscale-user-login'] ? 'https:' : url.protocol}//${url.host}`;
  if (request.headers.origin !== origin || ['cross-site', 'same-site'].includes(request.headers['sec-fetch-site'])) return reply(403, { error: 'このアプリから通知を設定してください' });
  if (!['POST', 'DELETE'].includes(request.method)) return reply(405, { error: 'Method not allowed' });
  try {
    let raw = '';
    for await (const chunk of request) { raw += chunk; if (raw.length > 8192) return reply(413, { error: '登録情報が大きすぎます' }); }
    const body = JSON.parse(raw);
    if (request.method === 'POST') service.subscribe(body, request.appBasePath);
    else service.unsubscribe(body.endpoint);
    return reply(200, { ok: true });
  } catch { return reply(400, { error: '通知を登録できませんでした。ページを開き直して再試行してください。' }); }
}
