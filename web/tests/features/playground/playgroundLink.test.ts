import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlaygroundLink, PlaygroundRequestError } from '@/features/playground/playgroundLink';
import type { ServiceLinkOptions } from '@/features/playground/playgroundLink';

interface FakeSocket {
  url: string;
  options: { path: string; auth: { token: string } };
  connected: boolean;
  emitted: [string, unknown][];
  handlers: Map<string, (...args: unknown[]) => void>;
  fire: (event: string, ...args: unknown[]) => void;
  disconnected: boolean;
  /** what the next `emitWithAck` answers; undefined never answers */
  answer: ((event: string, payload: unknown) => unknown) | undefined;
}

const sockets = vi.hoisted(() => [] as FakeSocket[]);

vi.mock('socket.io-client', () => ({
  io: (url: string, options: FakeSocket['options']) => {
    const socket: FakeSocket & Record<string, unknown> = {
      url, options, connected: false, emitted: [], handlers: new Map(), disconnected: false, answer: undefined,
      fire: (event, ...args) => { socket.handlers.get(event)?.(...args); },
      on: (event: string, fn: (...args: unknown[]) => void) => { socket.handlers.set(event, fn); return socket; },
      emit: (event: string, payload: unknown) => { socket.emitted.push([event, payload]); return socket; },
      removeAllListeners: () => { socket.handlers.clear(); return socket; },
      disconnect: () => { socket.disconnected = true; socket.connected = false; return socket; },
      timeout: (ms: number) => ({
        emitWithAck: (event: string, payload: unknown) => new Promise((resolve, reject) => {
          socket.emitted.push([event, payload]);
          if (socket.answer) resolve(socket.answer(event, payload));
          else setTimeout(() => reject(new Error('operation has timed out')), ms);
        }),
      }),
    };
    sockets.push(socket);
    return socket;
  },
}));

function setup(requestToken: () => boolean = () => true) {
  const requests = vi.fn(requestToken);
  const onMessage = vi.fn();
  const onConnect = vi.fn();
  const options: ServiceLinkOptions = { conversationId: 'conv', requestToken: requests, onMessage, onConnect };
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

  it('a question waits for the connection, and the service\'s refusal is an error', async () => {
    const { link, grant } = setup();
    link.start();
    const asked = link.request({ event: 'skin-get', payload: { userId: 'bia' } });
    grant('pass-1');
    await vi.advanceTimersByTimeAsync(0);
    sockets[0]!.answer = (_event, payload) => ((payload as { userId: string }).userId === 'bia' ? { skin: 'png' } : { error: 'not-here' });
    connect(sockets[0]!);
    await expect(asked).resolves.toEqual({ skin: 'png' });
    expect(sockets[0]!.emitted).toEqual([['skin-get', { userId: 'bia' }]]);
    await expect(link.request({ event: 'skin-get', payload: { userId: 'caio' } })).rejects.toEqual(new PlaygroundRequestError('not-here'));
    link.dispose();
  });

  it('a question fails when the link never connects, or the answer never comes', async () => {
    const { link, grant } = setup();
    link.start();
    const early = link.request({ event: 'skin-set', payload: { skin: null } });
    const failed = expect(early).rejects.toBeInstanceOf(PlaygroundRequestError);
    await vi.advanceTimersByTimeAsync(10_000);
    await failed;
    grant('pass-1');
    await vi.advanceTimersByTimeAsync(0);
    connect(sockets.at(-1)!);
    const silent = link.request({ event: 'skin-set', payload: { skin: null } });
    const unanswered = expect(silent).rejects.toEqual(new PlaygroundRequestError('unanswered'));
    await vi.advanceTimersByTimeAsync(5000);
    await unanswered;
    link.dispose();
    await expect(link.request({ event: 'skin-get', payload: { userId: 'bia' } })).rejects.toEqual(new PlaygroundRequestError('unavailable'));
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
