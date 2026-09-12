import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import { appBase, appUrl, appDataUrl, stripAppBase, mountedHtml, appFetch } from '../public/app-path.js';

test('local root and /sba coexist without double-prefixing or changing external URLs', () => {
  assert.equal(appBase({ pathname: '/sba' }), '/sba');
  assert.equal(appBase({ pathname: '/sba/search.html' }), '/sba');
  assert.equal(appBase({ pathname: '/sba-other/' }), '');
  assert.equal(appUrl('/api/recordings', '/sba'), '/sba/api/recordings');
  assert.equal(appUrl('/sba/api/recordings', '/sba'), '/sba/api/recordings');
  assert.equal(appUrl('/sba/api/recordings', ''), '/api/recordings');
  for (const value of ['https://r2.example/video?signature=abc', '//cdn.example/x', 'blob:http://localhost/x', './report.html', 'C:/recording.mp4']) assert.equal(appUrl(value, '/sba'), value);
  assert.equal(stripAppBase('/sba/api/analysis/id/match.json'), '/api/analysis/id/match.json');
});
test('API response URLs are rebased while metadata and source paths are preserved', () => {
  const source = { source: 'C:/recording.mp4', message: '/not-a-url', matches: [{ videoUrl: '/media/matches/id/clip.mp4', cloud: { url: '/api/cloud/id/1/play' }, thumbnailUrl: '/media/thumbnails/id/clip.jpg' }] };
  const result = JSON.parse(JSON.stringify(source, (_, value) => appDataUrl(value, '/sba')));
  assert.equal(result.matches[0].cloud.url, '/sba/api/cloud/id/1/play');
  assert.equal(result.matches[0].videoUrl, '/sba/media/matches/id/clip.mp4');
  assert.equal(result.source, source.source); assert.equal(result.message, source.message);
  assert.equal(source.matches[0].cloud.url, '/api/cloud/id/1/play');
});
test('HTML mounts assets and navigation but leaves external and relative links alone', () => {
  const html = '<a href="/">home</a><script type="module" src="/app.js?v=4"></script><link href="./styles.css"><a href="https://example.com/">external</a>';
  const result = mountedHtml(html, '/sba');
  assert.match(result, /href="\/sba\/"/); assert.match(result, /src="\/sba\/app.js\?v=4"/);
  assert.match(result, /href="\.\/styles.css"/); assert.match(result, /href="https:\/\/example.com\/"/);
});
test('path-aware fetch preserves POST options and prefixed query strings', async t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', { value: { pathname: '/sba/' }, configurable: true });
  t.after(() => { if (original) Object.defineProperty(globalThis, 'location', original); else delete globalThis.location; });
  const calls = []; t.mock.method(globalThis, 'fetch', async (...args) => { calls.push(args); return 'response'; });
  const options = { method: 'POST', body: '{}' };
  assert.equal(await appFetch('/api/analytics/refresh?x=1', options), 'response');
  assert.deepEqual(calls[0], ['/sba/api/analytics/refresh?x=1', options]);
});
test('service worker stays within /sba and does not delete other applications caches', async () => {
  const code = await fs.readFile(new URL('../public/sw.js', import.meta.url), 'utf8'), handlers = {}, deleted = [];
  const context = { URL, self: { registration: { scope: 'https://pc.test/sba/' }, location: { origin: 'https://pc.test' }, addEventListener: (name, callback) => { handlers[name] = callback; }, clients: { claim: async () => {} } },
    caches: { keys: async () => ['another-app', 'battle-review-shell-v3:root:old', 'battle-review-shell-v3:/sba:old'], delete: async key => { deleted.push(key); } } };
  vm.runInNewContext(code, context); let done;
  handlers.activate({ waitUntil: promise => { done = promise; } }); await done;
  assert.deepEqual(deleted, ['battle-review-shell-v3:/sba:old']);
  for (const pathname of ['/3dviewer/', '/sba/api/cloud/id/1/play', '/sba/media/matches/id/clip.mp4']) {
    handlers.fetch({ request: { method: 'GET', url: `https://pc.test${pathname}`, mode: 'no-cors' }, respondWith: () => assert.fail('must not intercept unrelated apps, APIs, or media') });
  }
});
