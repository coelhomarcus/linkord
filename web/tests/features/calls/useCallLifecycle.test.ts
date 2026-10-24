import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { DisconnectReason, RoomEvent } from 'livekit-client';
import type { Room } from 'livekit-client';
import { useCallLifecycle } from '@/features/calls/useCallLifecycle';

vi.mock('@/shared/sounds', () => ({
  playSound: vi.fn(),
  preloadSounds: vi.fn(),
  setVolume: vi.fn(),
}));

function fakeRoom(connect: () => Promise<void>) {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  return {
    emit: (event: string, ...args: unknown[]) => { for (const fn of listeners.get(event) ?? []) fn(...args); },
    on: vi.fn((event: string, fn: (...args: unknown[]) => void) => { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(fn); }),
    off: vi.fn((event: string, fn: (...args: unknown[]) => void) => { listeners.get(event)?.delete(fn); }),
    connect: vi.fn(connect),
    disconnect: vi.fn(),
    localParticipant: { identity: 'me', getTrackPublication: vi.fn(() => undefined) },
  } as unknown as Room & { emit: (event: string, ...args: unknown[]) => void };
}

function setup(connect: () => Promise<void> = async () => undefined, extras: {
  activateMic?: () => Promise<void>;
  setMicMuted?: (muted: boolean) => Promise<void>;
} = {}) {
  const dispatch = vi.fn();
  const sendWs = vi.fn();
  const livekitRoom = fakeRoom(connect);
  const activateMic = vi.fn(extras.activateMic ?? (async () => undefined));
  const setMicMuted = vi.fn(extras.setMicMuted ?? (async (_muted: boolean) => undefined));
  const { result } = renderHook(() => useCallLifecycle({
    livekitRoom, dispatch, sendWs,
    stopCamera: vi.fn(), stopSharing: vi.fn(),
    activateMic, setMicMuted, leaveMic: vi.fn(async () => undefined),
    cameraOn: false, sharing: false,
  }));
  return { result, dispatch, sendWs, livekitRoom, activateMic, setMicMuted };
}

const token = { conversationId: 'c1', livekitUrl: 'wss://lk', livekitToken: 't' };

describe('useCallLifecycle — call that failed to start', () => {
  it('a server rejection for a pending join becomes an error for that conversation', async () => {
    const { result, dispatch } = setup();
    await act(async () => { await result.current.joinCall('c1'); });

    let handled = false;
    act(() => { handled = result.current.onCallJoinRejected('Vocês precisam ser amigos pra iniciar essa chamada.'); });

    expect(handled).toBe(true);
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'SET_CALL_JOIN_ERROR', error: { conversationId: 'c1', message: 'Vocês precisam ser amigos pra iniciar essa chamada.' } });
  });

  it('with no pending join, the rejection is not for it (the same message answers other actions)', () => {
    const { result, dispatch } = setup();
    let handled = true;
    act(() => { handled = result.current.onCallJoinRejected('whatever'); });
    expect(handled).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('failing to connect to LiveKit: leaves the call, warns, and allows retrying', async () => {
    let livekitRoom: ReturnType<typeof fakeRoom> | null = null;
    // the real Room emits Disconnected before the connect() promise rejects
    const { result, dispatch, sendWs, livekitRoom: room } = setup(async () => {
      await Promise.resolve();
      livekitRoom!.emit(RoomEvent.Disconnected, DisconnectReason.UNKNOWN_REASON);
      throw new Error('could not establish signal connection');
    });
    livekitRoom = room;
    await act(async () => { await result.current.joinCall('c1'); });
    await act(async () => { result.current.onCallToken(token); });

    await vi.waitFor(() => expect(result.current.activeCallConversationId).toBeNull());
    expect(sendWs).toHaveBeenCalledWith({ t: 'call-leave' });
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_CALL_JOIN_ERROR', error: { conversationId: 'c1', message: expect.stringContaining('Não foi possível conectar à chamada') } });

    sendWs.mockClear();
    await act(async () => { await result.current.joinCall('c1'); });
    expect(sendWs).toHaveBeenCalledWith({ t: 'call-join', conversationId: 'c1' });
  });

  it('connection canceled because the person left first: no error', async () => {
    let rejectConnect: (err: Error) => void = () => {};
    const { result, dispatch } = setup(() => new Promise<void>((_resolve, reject) => { rejectConnect = reject; }));
    await act(async () => { await result.current.joinCall('c1'); });
    act(() => { result.current.onCallToken(token); });
    await act(async () => { await result.current.leaveCall(); });

    await act(async () => { rejectConnect(new Error('Client initiated disconnect')); });

    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'SET_CALL_JOIN_ERROR', error: expect.anything() }));
  });
});

describe('useCallLifecycle — preferMuted', () => {
  it('remembers the mute preference before a call exists', () => {
    const { result } = setup();
    expect(result.current.preferMuted).toBe(false);
    act(() => { result.current.setPreferMuted(true); });
    expect(result.current.preferMuted).toBe(true);
  });

  it('mutes the microphone after join when preferMuted is on', async () => {
    const { result, activateMic, setMicMuted } = setup();
    act(() => { result.current.setPreferMuted(true); });
    await act(async () => { await result.current.joinCall('c1'); });
    await act(async () => { result.current.onCallToken(token); });
    await vi.waitFor(() => expect(activateMic).toHaveBeenCalled());
    expect(setMicMuted).toHaveBeenCalledWith(true);
  });

  it('leaves the microphone open after join when preferMuted is off', async () => {
    const { result, activateMic, setMicMuted } = setup();
    await act(async () => { await result.current.joinCall('c1'); });
    await act(async () => { result.current.onCallToken(token); });
    await vi.waitFor(() => expect(activateMic).toHaveBeenCalled());
    expect(setMicMuted).not.toHaveBeenCalled();
  });

  it('mutes after join when deafened even if preferMuted is off', async () => {
    const { result, activateMic, setMicMuted } = setup();
    act(() => { result.current.toggleDeafened(); });
    setMicMuted.mockClear();
    await act(async () => { await result.current.joinCall('c1'); });
    await act(async () => { result.current.onCallToken(token); });
    await vi.waitFor(() => expect(activateMic).toHaveBeenCalled());
    expect(setMicMuted).toHaveBeenCalledWith(true);
  });
});
