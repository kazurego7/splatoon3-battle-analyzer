import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Pipeline } from './pipeline.mjs';
import { Store } from './store.mjs';
import { ANALYSIS_ROOT, MATCH_ROOT, PROJECT_ROOT, PUBLIC_ROOT, THUMBNAIL_ROOT } from './paths.mjs';

const PORT = Number(process.env.PORT || 4310);
const store = new Store();
await store.load();
const pipeline = new Pipeline(store);

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
};

function json(response, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length });
  response.end(body);
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

function safeJoin(root, segments) {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, ...segments.map(decodeURIComponent));
  if (target !== resolvedRoot && !target.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error('Invalid path');
  return target;
}

async function serveFile(request, response, file) {
  const stat = await fsp.stat(file);
  if (!stat.isFile()) throw new Error('Not a file');
  const type = mimeTypes[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const range = request.headers.range;
  if (range) {
    const match = range.match(/bytes=(\d*)-(\d*)/);
    const start = match?.[1] ? Number(match[1]) : 0;
    const end = match?.[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
    if (!match || start > end || start >= stat.size) {
      response.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      response.end();
      return;
    }
    response.writeHead(206, {
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Content-Length': end - start + 1,
    });
    fs.createReadStream(file, { start, end }).pipe(response);
    return;
  }
  response.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, 'Accept-Ranges': 'bytes' });
  fs.createReadStream(file).pipe(response);
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    const parts = url.pathname.split('/').filter(Boolean);

    if (request.method === 'GET' && url.pathname === '/api/recordings') {
      response.setHeader('Cache-Control', 'no-store');
      json(response, 200, store.list());
      return;
    }
    if (request.method === 'POST' && parts[0] === 'api' && parts[1] === 'recordings' && parts[3] === 'retry') {
      const recording = store.get(decodeURIComponent(parts[2]));
      if (!recording) return json(response, 404, { error: 'Recording not found' });
      pipeline.enqueue(recording.id, true);
      json(response, 202, { ok: true });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/scan') {
      await readJson(request);
      await pipeline.scan();
      json(response, 202, { ok: true });
      return;
    }
    if (request.method === 'GET' && parts[0] === 'api' && parts[1] === 'analysis') {
      // Re-analysis replaces the JSON at the same URL. Never let the browser
      // keep showing stale death markers or event timestamps.
      response.setHeader('Cache-Control', 'no-store');
      await serveFile(request, response, safeJoin(ANALYSIS_ROOT, parts.slice(2)));
      return;
    }
    if (request.method === 'GET' && parts[0] === 'media' && parts[1] === 'matches') {
      await serveFile(request, response, safeJoin(MATCH_ROOT, parts.slice(2)));
      return;
    }
    if (request.method === 'GET' && parts[0] === 'media' && parts[1] === 'thumbnails') {
      await serveFile(request, response, safeJoin(THUMBNAIL_ROOT, parts.slice(2)));
      return;
    }
    if (request.method === 'GET' && parts[0] === 'assets' && parts[1] === 'stage-maps') {
      await serveFile(request, response, safeJoin(path.join(PROJECT_ROOT, 'assets', 'stage-maps', 'images'), parts.slice(2)));
      return;
    }
    if (request.method === 'GET') {
      const relative = url.pathname === '/' ? ['index.html'] : parts;
      await serveFile(request, response, safeJoin(PUBLIC_ROOT, relative));
      return;
    }
    json(response, 404, { error: 'Not found' });
  } catch (error) {
    if (error.code === 'ENOENT') json(response, 404, { error: 'Not found' });
    else {
      console.error(error);
      json(response, 500, { error: error.message });
    }
  }
});

server.listen(PORT, '127.0.0.1', async () => {
  console.log(`Battle Review: http://127.0.0.1:${PORT}`);
  try {
    await pipeline.start({ autoProcess: process.env.AUTO_PROCESS !== 'false' });
  } catch (error) {
    console.error('Pipeline initialization failed:', error);
  }
});
