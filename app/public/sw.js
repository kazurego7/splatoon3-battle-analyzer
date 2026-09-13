const BASE_PATH = new URL(self.registration.scope).pathname.replace(/\/$/, '');
const CACHE_PREFIX = `battle-review-shell-v3:${BASE_PATH || 'root'}:`;
const CACHE_NAME = `${CACHE_PREFIX}mount-v5`;
const scoped = pathname => `${BASE_PATH}${pathname}`;
const APP_SHELL = [
  '/',
  '/index.html',
  '/styles.css?v=4',
  '/navigation.js?v=3',
  '/app.js?v=6',
  '/manifest.webmanifest',
  '/icons/app-icon-192.png',
  '/icons/app-icon-512.png',
  '/icons/app-icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon-32.png',
].map(scoped);

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  const url = new URL(event.request.url);
  if (!url.pathname.startsWith(`${BASE_PATH}/`)) return;
  const pathname = url.pathname.slice(BASE_PATH.length);
  if (pathname.startsWith('/api/') || pathname.startsWith('/media/') || pathname.startsWith('/matches/') || pathname.startsWith('/analysis/')) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match(scoped('/index.html'))));
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
        return response;
      })
      .catch(() => caches.match(event.request)),
  );
});

self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data?.json() || {}; } catch {}
  event.waitUntil(self.registration.showNotification(payload.title || 'AI分析が完了しました', {
    body: payload.body || 'アプリで分析結果を確認できます。',
    icon: scoped('/icons/app-icon-192.png'), badge: scoped('/icons/favicon-32.png'),
    tag: payload.tag || 'analysis-complete', data: { url: payload.url || scoped('/') },
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    let url = new URL(event.notification.data?.url || scoped('/'), self.location.origin);
    if (url.origin !== self.location.origin || !url.pathname.startsWith(`${BASE_PATH}/`)) url = new URL(scoped('/'), self.location.origin);
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      const current = new URL(client.url);
      if (current.origin === url.origin && current.pathname.startsWith(`${BASE_PATH}/`)) {
        try { const navigated = await client.navigate(url.href); if (navigated) return navigated.focus(); } catch {}
      }
    }
    return self.clients.openWindow(url.href);
  })());
});
