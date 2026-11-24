import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlaygroundLink } from '@/features/playground/playgroundLink';
import type { CombatLinkOptions } from '@/features/playground/playgroundLink';

interface FakeSocket {
  url: string;
  options: { path: string; auth: { token: string } };
  connected: boolean;
  emitted: [string, unknown][];
  handlers: Map<string, (...args: unknown[]) => void>;
  fire: (event: string, ...args: unknown[]) => void;
  disconnected: boolean;
}

const sockets = vi.hoisted(() => [] as FakeSocket[]);

vi.mock('socket.io-client', () => ({
  io: (url: string, options: FakeSocket['options']) => {
    const socket: FakeSocket & Record<string, unknown> = {
      url, options, connected: false, emitted: [], handlers: new Map(), disconnected: false,
      fire: (event, ...args) => { socket.handlers.get(event)?.(...args); },
      on: (event: string, fn: (...args: unknown[]) => void) => { socket.handlers.set(event, fn); return socket; },
      emit: (event: string, payload: unknown) => { socket.emitted.push([event, payload]); return socket; },
      removeAllListeners: () => { socket.handlers.clear(); return socket; },
      disconnect: () => { socket.disconnected = true; socket.connected = false; return socket; },
    };
    sockets.push(socket);
    return socket;
  },
}));

function setup(requestToken: () => boolean = () => true) {
  const requests = vi.fn(requestToken);
  const onMessage = vi.fn();
  const onConnect = vi.fn();
  const options: CombatLinkOptions = { conversationId: 'conv', requestToken: requests, onMessage, onConnect };
  const link = new PlaygroundLink(options);
  const grant = (token: string | null, url = 'https://chat.example.com') => link.receiveToken({ t: 'playground-token', conversationId: 'conv', ...(token ? { url } : {}), token });
  return { link, requests, onMessage, onConnect, grant };
}

const connect = (socket: FakeSocket) => {
  socket.connected = true;
  socket.fire('connect');
};

describe('PlaygroundLink', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sockets.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('connects to the service with the pass the app gave it', async () => {
    const { link, requests, onConnect, onMessage, grant } = setup();
    link.start();
    expect(requests).toHaveBeenCalledOnce();
    grant('pass-1');
    await vi.advanceTimersByTimeAsync(0);
    expect(sockets).toHaveLength(1);
    expect(sockets[0]!.url).toBe('https://chat.example.com');
    expect(sockets[0]!.options).toMatchObject({ path: '/playground/ws', auth: { token: 'pass-1' } });
    expect(link.send({ t: 'playground-respawn' })).toBe(false);
    connect(sockets[0]!);
    expect(onConnect).toHaveBeenCalledOnce();
    expect(link.send({ t: 'playground-respawn' })).toBe(true);
    expect(sockets[0]!.emitted).toEqual([['playground-respawn', { t: 'playground-respawn' }]]);
    const health = { t: 'playground-health', conversationId: 'conv', players: [] };
    sockets[0]!.fire('playground-health', health);
    expect(onMessage).toHaveBeenCalledWith(health);
    link.dispose();
    expect(sockets[0]!.disconnected).toBe(true);
  });

  it('renews the pass while connected', async () => {
    const { link, requests, grant } = setup();
    link.start();
    grant('pass-1');
    await vi.advanceTimersByTimeAsync(0);
    connect(sockets[0]!);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(requests).toHaveBeenCalledTimes(2);
    grant('pass-2');
    await vi.advanceTimersByTimeAsync(0);
    expect(sockets[0]!.emitted).toEqual([['renew', { token: 'pass-2' }]]);
    link.dispose();
  });

  it('stops for good when the app says no', async () => {
    const { link, requests, grant } = setup();
    link.start();
    grant(null);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(requests).toHaveBeenCalledOnce();
    expect(sockets).toHaveLength(0);
    link.dispose();
  });

  it('asks again later when the app does not answer, or the socket drops', async () => {
    let online = false;
    const { link, requests, grant } = setup(() => online);
    link.start();
    expect(sockets).toHaveLength(0);
    online = true;
    await vi.advanceTimersByTimeAsync(1500);
    expect(requests).toHaveBeenCalledTimes(2);
    // an answer that never comes
    await vi.advanceTimersByTimeAsync(5000 + 2500);
    expect(requests).toHaveBeenCalledTimes(3);
    grant('pass-1');
    await vi.advanceTimersByTimeAsync(0);
    connect(sockets[0]!);
    sockets[0]!.fire('disconnect', 'io server disconnect');
    expect(sockets[0]!.disconnected).toBe(true);
    await vi.advanceTimersByTimeAsync(1500);
    expect(requests).toHaveBeenCalledTimes(4);
    grant('pass-2');
    await vi.advanceTimersByTimeAsync(0);
    expect(sockets[1]!.options.auth.token).toBe('pass-2');
    link.dispose();
  });

  it('ignores answers for another call', async () => {
    const { link } = setup();
    link.start();
    link.receiveToken({ t: 'playground-token', conversationId: 'other', url: 'https://chat.example.com', token: 'pass' });
    await vi.advanceTimersByTimeAsync(0);
    expect(sockets).toHaveLength(0);
    link.dispose();
  });
});
