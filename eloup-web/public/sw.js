// EloUp service worker. Hand-rolled — no Workbox/next-pwa. ~50 lines.
// Strategy:
//   - Top-level HTML navigations (mode === 'navigate'): network-first, fall
//     back to precached /leaderboards shell on network failure.
//   - GET /api/leaderboards: stale-while-revalidate so cached data renders
//     instantly while a fresh fetch updates the cache for next visit.
//   - Same-origin static assets (/_next/static/*, /icon-*, /manifest.*):
//     cache-first (fingerprinted, safe to cache aggressively).
//   - Everything else (POST/PATCH/DELETE, /api/* other than leaderboards):
//     pass through to network.

const VERSION = 'eloup-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const RUNTIME_CACHE = `${VERSION}-runtime`;
const SHELL_URLS = ['/leaderboards', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL_URLS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => !k.startsWith(VERSION))
          .map((k) => caches.delete(k)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname === '/api/leaderboards') {
    event.respondWith(swr(req));
    return;
  }
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req));
    return;
  }
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icon-') ||
    url.pathname === '/manifest.webmanifest' ||
    url.pathname === '/apple-touch-icon.png'
  ) {
    event.respondWith(cacheFirst(req));
    return;
  }
});

async function networkFirst(req) {
  try {
    return await fetch(req);
  } catch {
    const cached = await caches.match('/leaderboards');
    return cached ?? new Response('Offline', { status: 503 });
  }
}

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  const resp = await fetch(req);
  if (resp.ok) {
    const cache = await caches.open(RUNTIME_CACHE);
    cache.put(req, resp.clone());
  }
  return resp;
}

async function swr(req) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(req);
  const fetched = fetch(req)
    .then((resp) => {
      if (resp.ok) cache.put(req, resp.clone());
      return resp;
    })
    .catch(() => cached ?? new Response('[]', { headers: { 'content-type': 'application/json' } }));
  return cached ?? fetched;
}
