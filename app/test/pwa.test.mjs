import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import vm from 'node:vm';

const publicRoot = new URL('../public/', import.meta.url);

test('PWAの先読みURLはHTMLが使用するCSS・JavaScriptと接続先ごとに一致する', async () => {
  const [index, worker] = await Promise.all([
    fs.readFile(new URL('index.html', publicRoot), 'utf8'),
    fs.readFile(new URL('sw.js', publicRoot), 'utf8'),
  ]);
  const assets = [...index.matchAll(/(?:src|href)="(\/[^\"]+\.(?:js|css)(?:\?[^\"]*)?)"/g)].map(match => match[1]);
  assert.ok(assets.length > 0);
  for (const base of ['', '/sba']) {
    const handlers = {}, cached = [];
    const context = { URL, self: {
      registration: { scope: `https://pc.test${base}/` },
      addEventListener: (name, listener) => { handlers[name] = listener; },
      skipWaiting: async () => {},
    }, caches: { open: async () => ({ addAll: async urls => { cached.push(...urls); } }) } };
    vm.runInNewContext(worker, context);
    let installed;
    handlers.install({ waitUntil: promise => { installed = promise; } });
    await installed;
    for (const asset of assets) assert.ok(cached.includes(base + asset), `先読み対象に ${base + asset} が必要`);
    assert.ok(!cached.some(url => /app\.js\?v=/.test(url) && !assets.includes(url.slice(base.length))));
  }
});

test('PWA manifestが通常・maskable・iOS用アイコンへ接続されている', async () => {
  const [manifestText, index, analytics, search, navigation, serviceWorker] = await Promise.all([
    fs.readFile(new URL('manifest.webmanifest', publicRoot), 'utf8'),
    fs.readFile(new URL('index.html', publicRoot), 'utf8'),
    fs.readFile(new URL('analytics.html', publicRoot), 'utf8'),
    fs.readFile(new URL('search.html', publicRoot), 'utf8'),
    fs.readFile(new URL('navigation.js', publicRoot), 'utf8'),
    fs.readFile(new URL('sw.js', publicRoot), 'utf8'),
  ]);
  const manifest = JSON.parse(manifestText);

  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/');
  assert.ok(manifest.icons.some(icon => icon.sizes === '192x192' && icon.purpose === 'any'));
  assert.ok(manifest.icons.some(icon => icon.sizes === '512x512' && icon.purpose === 'any'));
  assert.ok(manifest.icons.some(icon => icon.sizes === '512x512' && icon.purpose === 'maskable'));
  for (const page of [index, analytics, search]) {
    assert.match(page, /rel="manifest" href="\/manifest\.webmanifest"/);
    assert.match(page, /rel="apple-touch-icon" sizes="180x180" href="\/icons\/apple-touch-icon\.png"/);
  }
  assert.match(navigation, /serviceWorker\.register\(appUrl\('\/sw\.js'\), \{ scope: appUrl\('\/'\) \}\)/);
  assert.match(serviceWorker, /CACHE_NAME/);
});

test('PWAアイコンが宣言どおりのPNGサイズである', async () => {
  for (const [file, size] of [
    ['icons/app-icon-192.png', 192],
    ['icons/app-icon-512.png', 512],
    ['icons/app-icon-maskable-512.png', 512],
    ['icons/apple-touch-icon.png', 180],
    ['icons/favicon-32.png', 32],
  ]) {
    const metadata = await sharp(fileURLToPath(new URL(file, publicRoot))).metadata();
    assert.equal(metadata.format, 'png');
    assert.equal(metadata.width, size);
    assert.equal(metadata.height, size);
  }
});
