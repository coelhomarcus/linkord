// Linkord's service worker does one thing: a page navigation with no network
// gets a "Sem conexão" page instead of the browser's own error. It caches no
// app files on purpose — the app is realtime and nothing works offline, and a
// cached bundle would keep someone on an old version after a deploy. API,
// socket and upload requests are never touched.

const CACHE = 'linkord-offline-v1';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(new Request(OFFLINE_URL, { cache: 'reload' }))));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    // lets the browser start the navigation request while this worker boots
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith((async () => {
    try {
      const preloaded = await event.preloadResponse;
      return preloaded || await fetch(event.request);
    } catch {
      const cache = await caches.open(CACHE);
      return (await cache.match(OFFLINE_URL)) || Response.error();
    }
  })());
});
