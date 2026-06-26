// Custom service worker (Phase 2) — Workbox precache (injected) + Web Push handlers.
// Built by vite-plugin-pwa in injectManifest mode (strategies: 'injectManifest').
import { precacheAndRoute } from 'workbox-precaching';

precacheAndRoute(self.__WB_MANIFEST);

// Auto-update: a freshly-deployed worker activates immediately and takes control,
// so installed apps pick up the latest version on the next launch (no delete/re-add).
self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()); });

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data ? event.data.text() : '' }; }
  const title = data.title || 'Isheeka Events';
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.tag || undefined,
    renotify: !!data.tag,
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if ('focus' in c) {
        try { await c.focus(); if (url && url !== '/' && 'navigate' in c) await c.navigate(url); return; } catch (e) { /* noop */ }
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(url);
  })());
});
