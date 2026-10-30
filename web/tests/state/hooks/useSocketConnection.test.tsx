import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROTOCOL_VERSION } from '@/shared/types/protocol';
import { useSocketConnection } from '@/state/hooks/useSocketConnection';

type Handler = (...args: unknown[]) => void;
const fake = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  any: null as Handler | null,
  connected: false,
  connect: vi.fn(),
  disconnect: vi.fn(),
}));

vi.mock('socket.io-client', () => ({
  io: () => ({
    get connected() { return fake.connected; },
    on: (event: string, handler: Handler) => { fake.handlers.set(event, handler); },
    onAny: (handler: Handler) => { fake.any = handler; },
    connect: fake.connect,
    disconnect: fake.disconnect,
  }),
}));

beforeEach(() => {
  fake.handlers.clear();
  fake.any = null;
  fake.connected = false;
  fake.connect.mockReset().mockReturnThis();
  fake.disconnect.mockReset().mockReturnThis();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});
afterEach(() => { vi.useRealTimers(); });

function setup() {
  const sendWs = vi.fn();
  const onMessage = vi.fn();
  const dispatch = vi.fn();
  const refreshAuth = vi.fn().mockResolvedValue(undefined);
  const result = renderHook(() => useSocketConnection({
    socketRef: { current: null }, intentionalCloseRef: { current: false }, sendWs, dispatch, refreshAuth, onMessage,
  }));
  return { ...result, sendWs, onMessage, dispatch, refreshAuth };
}

describe('useSocketConnection', () => {
  it('joins with the protocol version and forwards server messages', () => {
    const { sendWs, onMessage } = setup();
    fake.handlers.get('connect')!();
    expect(sendWs).toHaveBeenCalledWith(expect.objectContaining({ t: 'join', v: PROTOCOL_VERSION }));
    fake.any!('error', { t: 'error', code: 'client_outdated', message: 'x' });
    expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ code: 'client_outdated' }));
  });

  it('resets a stale socket when the foreground probe times out', () => {
    vi.useFakeTimers();
    const { sendWs, dispatch } = setup();
    fake.connected = true;
    act(() => window.dispatchEvent(new Event('focus')));
    expect(sendWs).toHaveBeenCalledWith({ t: 'ping' });
    act(() => vi.advanceTimersByTime(5_000));
    expect(fake.disconnect).toHaveBeenCalledTimes(1);
    expect(fake.connect).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_RECONNECTING', value: true });
  });

  it('keeps a healthy socket when the probe gets a pong', () => {
    vi.useFakeTimers();
    setup();
    fake.connected = true;
    act(() => window.dispatchEvent(new Event('online')));
    fake.handlers.get('pong')!();
    act(() => vi.advanceTimersByTime(5_000));
    expect(fake.disconnect).not.toHaveBeenCalled();
  });

  it('reconnects promptly when the page resumes disconnected', () => {
    const { dispatch } = setup();
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(fake.connect).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_RECONNECTING', value: true });
  });

  it('forces a fresh join after a back-forward cache restore', () => {
    setup();
    const event = new Event('pageshow');
    Object.defineProperty(event, 'persisted', { value: true });
    act(() => window.dispatchEvent(event));
    expect(fake.disconnect).toHaveBeenCalledTimes(1);
    expect(fake.connect).toHaveBeenCalledTimes(1);
  });

  it('retries transient auth errors without logging out and refreshes expired sessions', () => {
    vi.useFakeTimers();
    const { refreshAuth } = setup();
    fake.handlers.get('connect_error')!(Object.assign(new Error('db unavailable'), { data: { code: 'auth_error' } }));
    expect(refreshAuth).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(5_000));
    expect(fake.connect).toHaveBeenCalledTimes(1);
    fake.handlers.get('connect_error')!(Object.assign(new Error('expired'), { data: { code: 'unauthorized' } }));
    expect(refreshAuth).toHaveBeenCalledTimes(1);
  });

  it('lets the user retry immediately', () => {
    const { result } = setup();
    act(() => result.current.retryConnection());
    expect(fake.disconnect).toHaveBeenCalledTimes(1);
    expect(fake.connect).toHaveBeenCalledTimes(1);
  });
});
