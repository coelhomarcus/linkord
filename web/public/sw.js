// The app is realtime, so only the offline page is cached. Push events are
// handled here because the browser can start this worker after every page
// has closed. API, socket and upload requests are never intercepted. The one
// POST taken over is the Web Share Target (see receiveShare).

const CACHE = 'linkord-offline-v1';
// Files from the system share sheet wait here until the picker page uses them.
// Keep these three in step with features/share/sharedPayload.ts.
const SHARE_CACHE = 'linkord-share-v1';
const SHARE_PATH = '/share-target';
const SHARE_TTL_MS = 60 * 60 * 1000;
const OFFLINE_URL = '/offline.html';
let badgeRequestId = 0;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(new Request(OFFLINE_URL, { cache: 'reload' }))));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE && key !== SHARE_CACHE) await caches.delete(key);
    await sweepShares();
    // lets the browser start the navigation request while this worker boots
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
    await self.clients.claim();
  })());
});

// A share arrives as a POST the page never sees. The files go to Cache Storage
// (they can be videos, too big for a message) and the browser is redirected to
// the picker, which reads them back by id and deletes them once used. A share
// nobody picks a place for expires, and so does anything left by a crash.
function shareUrl(id, part) {
  return new URL(`${SHARE_PATH}/${id}/${part}`, self.location.origin).href;
}

async function sweepShares() {
  try {
    const cache = await caches.open(SHARE_CACHE);
    const now = Date.now();
    for (const request of await cache.keys()) {
      const match = /^\/share-target\/([0-9a-f-]{36})\/meta$/.exec(new URL(request.url).pathname);
      if (!match) continue;
      const meta = await (await cache.match(request))?.json().catch(() => null);
      if (typeof meta?.createdAt === 'number' && now - meta.createdAt < SHARE_TTL_MS) continue;
      for (const stored of await cache.keys()) if (new URL(stored.url).pathname.startsWith(`${SHARE_PATH}/${match[1]}/`)) await cache.delete(stored);
    }
  } catch { /* an expired share lingering is harmless */ }
}

async function receiveShare(request) {
  const landing = (query) => Response.redirect(new URL(`/app/share${query}`, self.location.origin).href, 303);
  try {
    const form = await request.formData();
    const field = (name) => (typeof form.getAll(name)[0] === 'string' ? form.getAll(name)[0] : '');
    const files = form.getAll('files').filter((value) => typeof value !== 'string' && value.size > 0);
    const meta = { createdAt: Date.now(), title: field('title'), text: field('text'), url: field('url'), files: [] };
    if (!files.length && !meta.title && !meta.text && !meta.url) return landing('?failed=1');
    await sweepShares();
    const id = crypto.randomUUID();
    const cache = await caches.open(SHARE_CACHE);
    try {
      for (const [index, file] of files.entries()) {
        meta.files.push({ name: file.name, type: file.type, lastModified: file.lastModified });
        await cache.put(shareUrl(id, `file/${index}`), new Response(file, { headers: { 'content-type': file.type || 'application/octet-stream' } }));
      }
      await cache.put(shareUrl(id, 'meta'), new Response(JSON.stringify(meta), { headers: { 'content-type': 'application/json' } }));
    } catch (error) {
      for (let index = 0; index < files.length; index++) await cache.delete(shareUrl(id, `file/${index}`));
      throw error;
    }
    return landing(`?id=${id}`);
  } catch {
    return landing('?failed=1');
  }
}

self.addEventListener('fetch', (event) => {
  if (event.request.method === 'POST' && new URL(event.request.url).pathname === SHARE_PATH) {
    event.respondWith(receiveShare(event.request));
    return;
  }
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

// Uploads need the session cookie, which the browser's own icon loader may not send, so the
// worker fetches the sender's avatar itself and inlines it. Any failure keeps the app icon.
async function avatarIcon(avatar) {
  try {
    const target = new URL(avatar, self.location.origin);
    if (target.origin !== self.location.origin || !/^\/uploads\/[0-9a-f]{32}$/.test(target.pathname)) return null;
    const response = await self.fetch(target.pathname, { credentials: 'same-origin', signal: AbortSignal.timeout(2500) });
    if (!response.ok) return null;
    const type = response.headers.get('content-type') || '';
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!type.startsWith('image/') || bytes.length > 300_000) return null;
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return `data:${type};base64,${btoa(binary)}`;
  } catch {
    return null;
  }
}

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
  const tag = typeof notice?.tag === 'string' ? notice.tag : 'linkord';
  const notification = (async () => {
    const avatar = typeof notice?.avatar === 'string' ? await avatarIcon(notice.avatar) : null;
    await self.registration.showNotification(title, {
      body,
      icon: avatar || '/icons/icon-192.png',
      badge: '/icons/notification-badge-96.png',
      tag,
      // the browser rejects renotify without a tag
      renotify: notice?.renotify === true && !!tag,
      data: { path },
    });
  })();
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
