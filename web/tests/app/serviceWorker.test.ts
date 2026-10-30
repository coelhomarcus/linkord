import { describe, expect, it, vi } from 'vitest';
import workerSource from '../../public/sw.js?raw';

type WorkerEvent = { data?: { json: () => unknown }; notification?: { data: { path: string }; close: () => void }; waitUntil: (promise: Promise<unknown>) => void };

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
    clients: { matchAll: vi.fn(async () => windows), openWindow },
    navigator: badge,
    fetch,
    addEventListener: (name: string, handler: (event: WorkerEvent) => void) => { handlers.set(name, handler); },
  };
  new Function('self', 'URL', workerSource)(scope, URL);
  return { handlers, showNotification, openWindow, fetch };
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
