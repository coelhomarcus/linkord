import { File as NodeFile } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import workerSource from '../../public/sw.js?raw';
import { FakeCacheStorage } from '@tests/fixtures/fakeCacheStorage';

type WorkerEvent = { request?: unknown; respondWith?: (response: Promise<Response>) => void; data?: { json: () => unknown }; notification?: { data: { path: string }; close: () => void }; waitUntil: (promise: Promise<unknown>) => void };

function worker(
  windows: Array<{ url: string; focus: () => Promise<void>; postMessage: (message: unknown) => void }> = [],
  badge?: { setAppBadge: ReturnType<typeof vi.fn>; clearAppBadge: ReturnType<typeof vi.fn> },
) {
  const handlers = new Map<string, (event: WorkerEvent) => void>();
  const showNotification = vi.fn(async () => {});
  const openWindow = vi.fn(async () => {});
  const fetch = vi.fn(async () => new Response(JSON.stringify({ count: 3 }), { status: 200 }));
  const scope = {
    location: { origin: 'https://linkord.test' },
    registration: { showNotification },
    clients: { matchAll: vi.fn(async () => windows), openWindow, claim: vi.fn(async () => {}) },
    navigator: badge,
    fetch,
    addEventListener: (name: string, handler: (event: WorkerEvent) => void) => { handlers.set(name, handler); },
  };
  const caches = new FakeCacheStorage();
  new Function('self', 'URL', 'caches', 'crypto', workerSource)(scope, URL, caches, globalThis.crypto);
  return { handlers, showNotification, openWindow, fetch, caches };
}

describe('push service worker', () => {
  it('shows a notification with an internal conversation target', async () => {
    const { handlers, showNotification } = worker();
    let pending: Promise<unknown> = Promise.resolve();
    handlers.get('push')!({
      data: { json: () => ({ notification: { title: 'Conversa', body: 'Nova mensagem', navigate: 'https://linkord.test/app/conversations/abc', tag: 'chat-abc' } }) },
      waitUntil: (promise) => { pending = promise; },
    });
    await pending;
    expect(showNotification).toHaveBeenCalledWith('Conversa', expect.objectContaining({
      icon: '/icons/icon-192.png',
      badge: '/icons/notification-badge-96.png',
      data: { path: '/app/conversations/abc' },
    }));
  });

  it('shows the sender avatar as the icon and alerts again for a repeated tag', async () => {
    const { handlers, showNotification, fetch } = worker();
    fetch.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/jpeg' } }));
    let pending: Promise<unknown> = Promise.resolve();
    handlers.get('push')!({
      data: { json: () => ({ notification: { title: 'Ana', body: 'oi', navigate: 'https://linkord.test/app/channels/@me/abc', tag: 'chat-abc', renotify: true, avatar: 'https://linkord.test/uploads/' + 'a'.repeat(32) } }) },
      waitUntil: (promise) => { pending = promise; },
    });
    await pending;
    expect(fetch).toHaveBeenCalledWith('/uploads/' + 'a'.repeat(32), expect.objectContaining({ credentials: 'same-origin' }));
    expect(showNotification).toHaveBeenCalledWith('Ana', expect.objectContaining({ icon: 'data:image/jpeg;base64,AQID', renotify: true, tag: 'chat-abc' }));
  });

  it('keeps the app icon when the avatar is foreign or cannot be fetched', async () => {
    const { handlers, showNotification, fetch } = worker();
    let pending: Promise<unknown> = Promise.resolve();
    handlers.get('push')!({
      data: { json: () => ({ notification: { title: 'Ana', body: 'oi', tag: 'chat-abc', avatar: 'https://evil.test/uploads/' + 'a'.repeat(32) } }) },
      waitUntil: (promise) => { pending = promise; },
    });
    await pending;
    expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining('/uploads/'), expect.anything());
    fetch.mockResolvedValueOnce(new Response(null, { status: 404 }));
    handlers.get('push')!({
      data: { json: () => ({ notification: { title: 'Ana', body: 'oi', tag: 'chat-abc', avatar: '/uploads/' + 'b'.repeat(32) } }) },
      waitUntil: (promise) => { pending = promise; },
    });
    await pending;
    expect(showNotification).toHaveBeenLastCalledWith('Ana', expect.objectContaining({ icon: '/icons/icon-192.png', renotify: false }));
  });

  it('uses the server count for the app icon while showing a push notification', async () => {
    const badge = { setAppBadge: vi.fn(async () => {}), clearAppBadge: vi.fn(async () => {}) };
    const { handlers, showNotification, fetch } = worker([], badge);
    let pending: Promise<unknown> = Promise.resolve();
    handlers.get('push')!({ waitUntil: (promise) => { pending = promise; } });
    await pending;
    expect(fetch).toHaveBeenCalledWith('/api/notifications/badge', { credentials: 'same-origin', cache: 'no-store' });
    expect(badge.setAppBadge).toHaveBeenCalledWith(3);
    expect(showNotification).toHaveBeenCalledOnce();
  });

  it('clears a stale badge when the session has ended', async () => {
    const badge = { setAppBadge: vi.fn(async () => {}), clearAppBadge: vi.fn(async () => {}) };
    const { handlers, fetch } = worker([], badge);
    fetch.mockResolvedValueOnce(new Response(null, { status: 401 }));
    let pending: Promise<unknown> = Promise.resolve();
    handlers.get('push')!({ waitUntil: (promise) => { pending = promise; } });
    await pending;
    expect(badge.clearAppBadge).toHaveBeenCalledOnce();
    expect(badge.setAppBadge).not.toHaveBeenCalled();
  });

  it('clears the icon after a push when nothing remains unread', async () => {
    const badge = { setAppBadge: vi.fn(async () => {}), clearAppBadge: vi.fn(async () => {}) };
    const { handlers, fetch } = worker([], badge);
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ count: 0 }), { status: 200 }));
    let pending: Promise<unknown> = Promise.resolve();
    handlers.get('push')!({ waitUntil: (promise) => { pending = promise; } });
    await pending;
    expect(badge.clearAppBadge).toHaveBeenCalledOnce();
  });

  it('still shows the notification when badge synchronization fails', async () => {
    const badge = { setAppBadge: vi.fn(async () => {}), clearAppBadge: vi.fn(async () => {}) };
    const { handlers, fetch, showNotification } = worker([], badge);
    fetch.mockRejectedValueOnce(new Error('offline'));
    let pending: Promise<unknown> = Promise.resolve();
    handlers.get('push')!({ waitUntil: (promise) => { pending = promise; } });
    await pending;
    expect(showNotification).toHaveBeenCalledOnce();
  });

  it('opens the target after all pages have closed', async () => {
    const { handlers, openWindow } = worker();
    let pending: Promise<unknown> = Promise.resolve();
    handlers.get('notificationclick')!({
      notification: { data: { path: '/app/friends?tab=invitations' }, close: vi.fn() },
      waitUntil: (promise) => { pending = promise; },
    });
    await pending;
    expect(openWindow).toHaveBeenCalledWith('/app/friends?tab=invitations');
  });

  it('focuses an open app and forwards the target to its memory router', async () => {
    const client = { url: 'https://linkord.test/', focus: vi.fn(async () => {}), postMessage: vi.fn() };
    const { handlers, openWindow } = worker([client]);
    let pending: Promise<unknown> = Promise.resolve();
    handlers.get('notificationclick')!({
      notification: { data: { path: '/app/conversations/abc' }, close: vi.fn() },
      waitUntil: (promise) => { pending = promise; },
    });
    await pending;
    expect(client.focus).toHaveBeenCalledOnce();
    expect(client.postMessage).toHaveBeenCalledWith({ type: 'linkord-push-navigation', path: '/app/conversations/abc' });
    expect(openWindow).not.toHaveBeenCalled();
  });
});

describe('share target', () => {
  const SHARE_CACHE = 'linkord-share-v1';

  // jsdom's File has no stream(), which Response needs; the worker only reads getAll
  type Shared = { title?: string; text?: string; url?: string; files?: Array<{ name: string; type: string; body: string }> };
  const shared = (fields: Shared = {}) => ({
    getAll: (name: string): unknown[] => name === 'files'
      ? (fields.files ?? []).map((file) => new NodeFile([file.body], file.name, { type: file.type }))
      : fields[name as 'title' | 'text' | 'url'] === undefined ? [] : [fields[name as 'title' | 'text' | 'url']],
  });

  function sharePost(form: ReturnType<typeof shared>) {
    return { method: 'POST', mode: 'cors', url: 'https://linkord.test/share-target', formData: async () => form };
  }

  async function dispatch(handlers: Map<string, (event: WorkerEvent) => void>, request: unknown) {
    let answer: Promise<Response> | undefined;
    handlers.get('fetch')!({ request, respondWith: (response) => { answer = response; }, waitUntil: () => {} });
    return answer;
  }

  it('stores the shared files and redirects to the picker with the share id', async () => {
    const { handlers, caches } = worker();
    const form = shared({ title: 'Clip', text: 'olha isso', files: [{ name: 'a.png', type: 'image/png', body: 'abc' }, { name: 'b.mp4', type: 'video/mp4', body: 'defg' }] });

    const response = await dispatch(handlers, sharePost(form));

    expect(response?.status).toBe(303);
    const location = new URL(response!.headers.get('location')!);
    expect(location.pathname).toBe('/app/share');
    const id = location.searchParams.get('id')!;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const store = await caches.open(SHARE_CACHE);
    const meta = await (await store.match(`https://linkord.test/share-target/${id}/meta`))!.json();
    expect(meta).toMatchObject({ title: 'Clip', text: 'olha isso', url: '', files: [{ name: 'a.png', type: 'image/png' }, { name: 'b.mp4', type: 'video/mp4' }] });
    expect(await (await store.match(`https://linkord.test/share-target/${id}/file/1`))!.text()).toBe('defg');
  });

  it('keeps a text-only share and refuses an empty one', async () => {
    const { handlers, caches } = worker();
    const kept = await dispatch(handlers, sharePost(shared({ url: 'https://example.com/a' })));
    expect(new URL(kept!.headers.get('location')!).searchParams.get('id')).toBeTruthy();
    expect(caches.entries(SHARE_CACHE)).toHaveLength(1);

    const empty = await dispatch(handlers, sharePost(shared()));
    expect(new URL(empty!.headers.get('location')!).search).toBe('?failed=1');
  });

  it('lands on the failure notice instead of an error page when the body cannot be read', async () => {
    const { handlers } = worker();
    const response = await dispatch(handlers, { ...sharePost(shared()), formData: async () => { throw new Error('boom'); } });
    expect(response?.status).toBe(303);
    expect(new URL(response!.headers.get('location')!).search).toBe('?failed=1');
  });

  it('only takes over the POST to the share path', async () => {
    const { handlers } = worker();
    expect(await dispatch(handlers, { method: 'GET', mode: 'cors', url: 'https://linkord.test/share-target' })).toBeUndefined();
    expect(await dispatch(handlers, { method: 'POST', mode: 'cors', url: 'https://linkord.test/api/messages' })).toBeUndefined();
  });

  it('drops shares older than the time limit when the next one arrives, and keeps the fresh ones', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const { handlers, caches } = worker();
      const old = shared({ text: 'velho' });
      const oldId = new URL((await dispatch(handlers, sharePost(old)))!.headers.get('location')!).searchParams.get('id')!;
      vi.setSystemTime(Date.now() + 30 * 60 * 1000);
      const middle = shared({ text: 'meio' });
      const middleId = new URL((await dispatch(handlers, sharePost(middle)))!.headers.get('location')!).searchParams.get('id')!;
      vi.setSystemTime(Date.now() + 40 * 60 * 1000);
      const next = shared({ text: 'novo' });
      await dispatch(handlers, sharePost(next));

      const left = caches.entries(SHARE_CACHE).join(' ');
      expect(left).not.toContain(oldId);
      expect(left).toContain(middleId);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the share cache when the worker activates', async () => {
    const { handlers, caches } = worker();
    (await caches.open(SHARE_CACHE)).put('https://linkord.test/share-target/x/meta', new Response('{}'));
    await caches.open('linkord-offline-v0');
    let pending: Promise<unknown> = Promise.resolve();
    handlers.get('activate')!({ waitUntil: (promise) => { pending = promise; } });
    await pending;
    expect(await caches.keys()).toContain(SHARE_CACHE);
    expect(await caches.keys()).not.toContain('linkord-offline-v0');
  });
});
