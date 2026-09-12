import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

const compressed = new Map();
// Bounded cache: compress each distinct response once, without retaining videos.
export function sendBody(request, response, body, type, { status = 200, cache = 'private, no-cache' } = {}) {
  body = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const hash = createHash('sha256').update(body).digest('base64url');
  const acceptsGzip = String(request.headers['accept-encoding'] || '').split(',').some(part => /^gzip(?:\s*;|\s*$)/i.test(part.trim()) && !/;\s*q=0(?:\.0*)?\s*$/i.test(part));
  const zipped = body.length > 1024 && /text|json|javascript|svg/.test(type) && acceptsGzip;
  const etag = `"${hash}${zipped ? '-gz' : ''}"`;
  const headers = { 'Content-Type': type, 'Cache-Control': cache, Vary: 'Accept-Encoding', ETag: etag };
  if (zipped) headers['Content-Encoding'] = 'gzip';
  if (status === 200 && ['GET', 'HEAD'].includes(request.method) && String(request.headers['if-none-match'] || '').split(',').some(tag => tag.trim().replace(/^W\//, '') === etag || tag.trim() === '*')) {
    response.writeHead(304, headers); response.end(); return;
  }
  if (zipped) {
    let entry = compressed.get(hash);
    if (!entry) {
      entry = gzipSync(body);
      if (entry.length < 2_000_000) {
        compressed.set(hash, entry);
        if (compressed.size > 128) compressed.delete(compressed.keys().next().value);
      }
    }
    body = entry;
  }
  response.writeHead(status, { ...headers, 'Content-Length': body.length });
  response.end(request.method === 'HEAD' ? undefined : body);
}
