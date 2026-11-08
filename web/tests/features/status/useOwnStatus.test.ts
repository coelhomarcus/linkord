import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useOwnStatus } from '@/features/status/useOwnStatus';
import { isDoNotDisturb } from '@/shared/doNotDisturb';
import type { ClientMessage } from '@/shared/types/protocol';

function setup(connected = true) {
  const sent: ClientMessage[] = [];
  const sendWs = vi.fn((msg: ClientMessage) => { sent.push(msg); return connected; });
  const hook = renderHook(() => useOwnStatus({ sendWs }));
  return { ...hook, sent };
}

const requestIdOf = (msg: ClientMessage | undefined) => (msg as { requestId: string }).requestId;

afterEach(() => { vi.useRealTimers(); });

describe('useOwnStatus', () => {
  it('starts from the welcome, and a server without statuses means online', () => {
    const { result } = setup();
    act(() => result.current.onSnapshot({ status: 'idle', effective: 'idle', customStatus: null }));
    expect(result.current.ownStatus.status).toBe('idle');
    act(() => result.current.onSnapshot(undefined));
    expect(result.current.ownStatus).toEqual({ status: 'online', effective: 'online', customStatus: null });
  });

  it('shows a change at once and keeps it when the server confirms', async () => {
    const { result, sent } = setup();
    let done!: Promise<void>;
    act(() => { done = result.current.setPresence({ status: 'dnd' }); });
    expect(result.current.ownStatus.status).toBe('dnd');
    expect(sent[0]).toMatchObject({ t: 'presence-set', status: 'dnd' });

    act(() => result.current.onMyStatus({ t: 'my-status', status: 'dnd', effective: 'dnd', customStatus: null }));
    act(() => result.current.onResult({ t: 'presence-result', requestId: requestIdOf(sent[0]), ok: true }));
    await expect(done).resolves.toBeUndefined();
    expect(result.current.ownStatus.status).toBe('dnd');
  });

  it('puts the status back when the server refuses', async () => {
    const { result, sent } = setup();
    let done!: Promise<void>;
    act(() => { done = result.current.setPresence({ customStatus: { emoji: '🎮', text: 'x', expiresAt: null } }); });
    expect(result.current.ownStatus.customStatus?.text).toBe('x');
    await act(async () => {
      result.current.onResult({ t: 'presence-result', requestId: requestIdOf(sent[0]), ok: false });
      await expect(done).rejects.toThrow('Não foi possível mudar seu status');
    });
    expect(result.current.ownStatus.customStatus).toBeNull();
  });

  it('puts the status back when no answer arrives', async () => {
    vi.useFakeTimers();
    const { result } = setup();
    let done!: Promise<void>;
    act(() => { done = result.current.setPresence({ status: 'invisible' }); });
    const settled = done.catch((err: Error) => err.message);
    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(await settled).toMatch('Não foi possível mudar seu status');
    expect(result.current.ownStatus.status).toBe('online');
  });

  it('refuses at once while offline', async () => {
    const { result } = setup(false);
    await expect(result.current.setPresence({ status: 'dnd' })).rejects.toThrow('Sem conexão');
    expect(result.current.ownStatus.status).toBe('online');
  });

  it('do not disturb follows the account, from any device', () => {
    const { result } = setup();
    act(() => result.current.onMyStatus({ t: 'my-status', status: 'dnd', effective: 'dnd', customStatus: null }));
    expect(isDoNotDisturb()).toBe(true);
    act(() => result.current.onMyStatus({ t: 'my-status', status: 'online', effective: 'online', customStatus: null }));
    expect(isDoNotDisturb()).toBe(false);
  });
});
