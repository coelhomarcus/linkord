import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { DisconnectReason, RoomEvent, Track } from 'livekit-client';
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
  const startCamera = vi.fn(async () => undefined);
  const { result } = renderHook(() => useCallLifecycle({
    livekitRoom, dispatch, sendWs,
    stopCamera: vi.fn(), stopSharing: vi.fn(),
    activateMic, setMicMuted, leaveMic: vi.fn(async () => undefined), startCamera,
    cameraOn: false, sharing: false,
  }));
  return { result, dispatch, sendWs, livekitRoom, activateMic, setMicMuted, startCamera };
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

describe('useCallLifecycle — moving between voice channels', () => {
  it('moving someone asks the server, naming who and where', () => {
    const { result, sendWs } = setup();
    act(() => { result.current.moveToCall('p-bea', 'voice-2'); });
    expect(sendWs).toHaveBeenCalledWith({ t: 'call-move', participantId: 'p-bea', conversationId: 'voice-2' });
  });

  it('being moved leaves the old call and joins the new one', async () => {
    const { result, sendWs } = setup();
    await act(async () => { await result.current.joinCall('voice-1'); });
    await act(async () => { result.current.onCallToken({ ...token, conversationId: 'voice-1' }); });
    sendWs.mockClear();

    await act(async () => { result.current.onCallMoved('voice-2'); });

    await vi.waitFor(() => expect(sendWs).toHaveBeenCalledWith({ t: 'call-join', conversationId: 'voice-2' }));
    expect(sendWs).toHaveBeenCalledWith({ t: 'call-leave' });
  });
});

describe('useCallLifecycle — what a publication actually means', () => {
  it('reports a muted camera as off, to the server and to the local button', () => {
    const { sendWs, dispatch, livekitRoom } = setup();
    livekitRoom.localParticipant.getTrackPublication = ((source: Track.Source) => (
      source === Track.Source.Camera ? { isMuted: true, track: { mediaStreamTrack: { readyState: 'live' } } } : undefined
    )) as typeof livekitRoom.localParticipant.getTrackPublication;

    act(() => { livekitRoom.emit(RoomEvent.TrackMuted, { source: Track.Source.Camera }, { identity: 'me' }); });

    expect(sendWs).toHaveBeenCalledWith({ t: 'camera', on: false });
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_LOCAL_CAMERA', on: false });
  });

  it('keeps a paused screen share on, and drops one whose capture has ended', () => {
    const { sendWs, dispatch, livekitRoom } = setup();
    const publication = { isMuted: true, track: { mediaStreamTrack: { readyState: 'live' as string } } };
    livekitRoom.localParticipant.getTrackPublication = ((source: Track.Source) => (
      source === Track.Source.ScreenShare ? publication : undefined
    )) as typeof livekitRoom.localParticipant.getTrackPublication;

    act(() => { livekitRoom.emit(RoomEvent.TrackMuted, { source: Track.Source.ScreenShare }, { identity: 'me' }); });
    expect(sendWs).toHaveBeenCalledWith({ t: 'screen-share', on: true });
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_LOCAL_SHARING', sharing: true });

    publication.track.mediaStreamTrack.readyState = 'ended';
    sendWs.mockClear();
    act(() => { livekitRoom.emit(RoomEvent.TrackMuted, { source: Track.Source.ScreenShare }, { identity: 'me' }); });
    expect(sendWs).toHaveBeenCalledWith({ t: 'screen-share', on: false });
  });

  it('ignores another participant muting their own camera', () => {
    const { sendWs, livekitRoom } = setup();
    act(() => { livekitRoom.emit(RoomEvent.TrackMuted, { source: Track.Source.Camera }, { identity: 'someone-else' }); });
    expect(sendWs).not.toHaveBeenCalledWith(expect.objectContaining({ t: 'camera' }));
  });
});

describe('useCallLifecycle — DM media', () => {
  it('ignores a token until this tab is armed, then connects and starts the camera for a video call', async () => {
    const { result, livekitRoom, startCamera } = setup();
    act(() => { result.current.onCallToken(token); });
    expect(livekitRoom.connect).not.toHaveBeenCalled();

    act(() => { result.current.armDmMedia('c1', true); });
    await act(async () => { result.current.onCallToken(token); });
    await vi.waitFor(() => expect(livekitRoom.connect).toHaveBeenCalledWith('wss://lk', 't'));
    expect(startCamera).toHaveBeenCalledOnce();
  });

  it('a voice DM connects without turning the camera on', async () => {
    const { result, livekitRoom, startCamera } = setup();
    act(() => { result.current.armDmMedia('c1', false); });
    await act(async () => { result.current.onCallToken(token); });
    await vi.waitFor(() => expect(livekitRoom.connect).toHaveBeenCalled());
    expect(startCamera).not.toHaveBeenCalled();
  });
});
