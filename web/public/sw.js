// The app is realtime, so only the offline page is cached. Push events are
// handled here because the browser can start this worker after every page
// has closed. API, socket and upload requests are never intercepted.

const CACHE = 'linkord-offline-v1';
const OFFLINE_URL = '/offline.html';
let badgeRequestId = 0;

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

self.addEventListener('push', (event) => {
  let notice;
  try { notice = event.data?.json()?.notification; } catch { /* still show a visible fallback */ }
  const title = typeof notice?.title === 'string' && notice.title ? notice.title : 'Linkord';
  const body = typeof notice?.body === 'string' ? notice.body : 'Você tem uma nova notificação.';
  let path = '/app/conversations';
  try {
    const target = new URL(notice?.navigate, self.location.origin);
    if (target.origin === self.location.origin && target.pathname.startsWith('/app/')) path = target.pathname + target.search + target.hash;
  } catch { /* keep the safe default */ }
  const notification = self.registration.showNotification(title, {
    body,
    icon: '/icons/icon-192.png',
    badge: '/icons/notification-badge-96.png',
    tag: typeof notice?.tag === 'string' ? notice.tag : 'linkord',
    data: { path },
  });
  const badge = (async () => {
    if (typeof self.navigator?.setAppBadge !== 'function') return;
    const requestId = ++badgeRequestId;
    try {
      const response = await self.fetch('/api/notifications/badge', { credentials: 'same-origin', cache: 'no-store' });
      if (requestId !== badgeRequestId) return;
      if (response.status === 401) {
        if (typeof self.navigator.clearAppBadge === 'function') await self.navigator.clearAppBadge();
        else await self.navigator.setAppBadge(0);
        return;
      }
      if (!response.ok) return;
      const count = (await response.json()).count;
      if (!Number.isSafeInteger(count) || count < 0) return;
      if (count === 0 && typeof self.navigator.clearAppBadge === 'function') await self.navigator.clearAppBadge();
      else await self.navigator.setAppBadge(count);
    } catch { /* a notification still appears if the badge cannot be updated */ }
  })();
  event.waitUntil(Promise.all([notification, badge]));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = event.notification.data?.path || '/app/conversations';
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing) {
      await existing.focus();
      existing.postMessage({ type: 'linkord-push-navigation', path });
    } else {
      await self.clients.openWindow(path);
    }
  })());
});
