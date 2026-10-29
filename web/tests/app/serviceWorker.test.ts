import { describe, expect, it, vi } from 'vitest';
import workerSource from '../../public/sw.js?raw';

type WorkerEvent = { data?: { json: () => unknown }; notification?: { data: { path: string }; close: () => void }; waitUntil: (promise: Promise<unknown>) => void };

function worker(windows: Array<{ url: string; focus: () => Promise<void>; postMessage: (message: unknown) => void }> = []) {
  const handlers = new Map<string, (event: WorkerEvent) => void>();
  const showNotification = vi.fn(async () => {});
  const openWindow = vi.fn(async () => {});
  const scope = {
    location: { origin: 'https://linkord.test' },
    registration: { showNotification },
    clients: { matchAll: vi.fn(async () => windows), openWindow },
    addEventListener: (name: string, handler: (event: WorkerEvent) => void) => { handlers.set(name, handler); },
  };
  new Function('self', 'URL', workerSource)(scope, URL);
  return { handlers, showNotification, openWindow };
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
    expect(showNotification).toHaveBeenCalledWith('Conversa', expect.objectContaining({ data: { path: '/app/conversations/abc' } }));
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
