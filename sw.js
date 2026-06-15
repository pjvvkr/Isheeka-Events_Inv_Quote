/* Isheeka Events ERP — service worker
   Goal: make the app installable + fast/offline-tolerant, WITHOUT serving stale builds.
   - The app HTML uses NETWORK-FIRST: you always get the latest when online; cache is the offline fallback.
   - CDN libraries (versioned, immutable) use CACHE-FIRST.
   - Supabase API + auth + storage + any non-GET request are never cached (always live).
   Bump CACHE_VERSION to force-refresh all caches. */
const CACHE_VERSION = 'isheeka-v2';
const APP_SHELL = ['./isheeka-erp-v22.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE_VERSION).then((c) => c.addAll(APP_SHELL).catch(() => {})));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return; // never cache writes
  const url = new URL(req.url);

  // Never intercept Supabase (API/auth/realtime/storage) — must always be live.
  if (/supabase\.(co|in|net)/.test(url.hostname) || url.hostname.includes('supabase')) return;

  const isAppHtml = req.mode === 'navigate' || url.pathname.endsWith('isheeka-erp-v22.html');

  if (isAppHtml) {
    // network-first: freshest build wins; fall back to cache offline
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_VERSION).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(req).then((m) => m || caches.match('./isheeka-erp-v22.html')))
    );
    return;
  }

  // everything else (CDN libs, icons): cache-first, then network (and cache it)
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res && (res.status === 200 || res.type === 'opaque')) {
        const copy = res.clone();
        caches.open(CACHE_VERSION).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => hit))
  );
});
