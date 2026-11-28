import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ConnectionQuality, Track } from 'livekit-client';
import type { Participant, Room } from 'livekit-client';
import {
  activeTrack, getParticipant, isScreenPaused, useConnectionQuality, useParticipantMedia,
} from '@/features/calls/useLiveKitTrack';
import { RoomStoreProvider } from '@/state/RoomStoreProvider';
import { createFakeRoomContextValue } from '@tests/fixtures/roomContextFixture';

/** A minimal but real pub-sub fake — `on`/`off` are spies wrapping an actual
 * listener registry, so events genuinely reach whoever subscribed (needed to
 * prove sharing: a fake that just no-ops would "pass" even if every watcher
 * secretly got its own broken registration). */
function fakeEventRoom() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const on = vi.fn((event: string, cb: (...args: unknown[]) => void) => {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event)!.add(cb);
  });
  const off = vi.fn((event: string, cb: (...args: unknown[]) => void) => {
    listeners.get(event)?.delete(cb);
  });
  const participants = new Map<string, Participant>();
  const raw = {
    on,
    off,
    localParticipant: { identity: '__local__', getTrackPublication: () => undefined },
    getParticipantByIdentity: (id: string) => participants.get(id),
    emit(event: string, ...args: unknown[]) { for (const cb of listeners.get(event) ?? []) cb(...args); },
    addParticipant(id: string, p: Partial<Participant>) { participants.set(id, p as Participant); },
  };
  const room = raw as unknown as Room & { emit: (event: string, ...args: unknown[]) => void; addParticipant: (id: string, p: Partial<Participant>) => void };
  return { room, on, off };
}

function roomWrapper(room: Room) {
  return ({ children }: { children: ReactNode }) => (
    <RoomStoreProvider value={createFakeRoomContextValue({ livekitRoom: room })}>{children}</RoomStoreProvider>
  );
}

describe('getParticipant', () => {
  it('returns the localParticipant when the identity matches itself', () => {
    const local = { identity: 'me' };
    const room = { localParticipant: local, getParticipantByIdentity: () => undefined } as unknown as Room;
    expect(getParticipant(room, 'me')).toBe(local);
  });

  it('returns the remote participant found by identity', () => {
    const remote = { identity: 'other' };
    const room = {
      localParticipant: { identity: 'me' },
      getParticipantByIdentity: (id: string) => (id === 'other' ? remote : undefined),
    } as unknown as Room;
    expect(getParticipant(room, 'other')).toBe(remote);
  });

  it('unknown identity returns undefined', () => {
    const room = { localParticipant: { identity: 'me' }, getParticipantByIdentity: () => undefined } as unknown as Room;
    expect(getParticipant(room, 'ghost')).toBeUndefined();
  });
});

describe('activeTrack', () => {
  function fakeParticipant(pub: { isMuted: boolean; track: unknown } | null): Participant {
    return { getTrackPublication: () => pub } as unknown as Participant;
  }

  it('with no publication at all, returns null', () => {
    expect(activeTrack(fakeParticipant(null), Track.Source.Camera)).toBeNull();
  });

  it('a MUTED publication returns null even with the track still existing — turning off camera/screen does not unpublish, only mutes', () => {
    const p = fakeParticipant({ isMuted: true, track: { id: 'realtrack' } });
    expect(activeTrack(p, Track.Source.Camera)).toBeNull();
  });

  it('an active (not muted) publication returns the track', () => {
    const track = { id: 'realtrack' };
    const p = fakeParticipant({ isMuted: false, track });
    expect(activeTrack(p, Track.Source.Camera)).toBe(track);
  });

  it('an active publication but without an attached track still returns null (never undefined)', () => {
    const p = fakeParticipant({ isMuted: false, track: undefined });
    expect(activeTrack(p, Track.Source.Camera)).toBeNull();
  });
});

describe('isScreenPaused', () => {
  function fakeParticipant(pub: { isMuted: boolean; track: unknown } | undefined): Participant {
    return { getTrackPublication: () => pub } as unknown as Participant;
  }

  it("with no publication at all, false (not paused, doesn't exist)", () => {
    expect(isScreenPaused(fakeParticipant(undefined))).toBe(false);
  });

  it('an active (not muted) publication, false — sharing normally', () => {
    expect(isScreenPaused(fakeParticipant({ isMuted: false, track: {} }))).toBe(false);
  });

  it('recognizes the presenter pause while the viewer is unsubscribed', () => {
    expect(isScreenPaused(fakeParticipant({ isMuted: true, track: undefined }))).toBe(true);
  });

  it('a muted publication with a track present, true — intentionally paused (pauseSharePreview)', () => {
    expect(isScreenPaused(fakeParticipant({ isMuted: true, track: {} }))).toBe(true);
  });
});

describe('useParticipantMedia — subscription shared by identity', () => {
  it('two instances watching the SAME identity register the LiveKit listeners only once', () => {
    const { room, on, off } = fakeEventRoom();
    const wrapper = roomWrapper(room);

    const a = renderHook(() => useParticipantMedia('p-2'), { wrapper });
    const onCallsAfterFirst = on.mock.calls.length;
    expect(onCallsAfterFirst).toBeGreaterThan(0);

    const b = renderHook(() => useParticipantMedia('p-2'), { wrapper });
    expect(on.mock.calls.length).toBe(onCallsAfterFirst);

    a.unmount();
    expect(off).not.toHaveBeenCalled();

    b.unmount();
    expect(off.mock.calls.length).toBe(onCallsAfterFirst);
  });

  it('DIFFERENT identities keep fully independent subscriptions', () => {
    const { room, on } = fakeEventRoom();
    const wrapper = roomWrapper(room);

    renderHook(() => useParticipantMedia('p-2'), { wrapper });
    const afterFirst = on.mock.calls.length;
    renderHook(() => useParticipantMedia('p-3'), { wrapper });
    expect(on.mock.calls.length).toBe(afterFirst * 2);
  });

  it('a real track event reflects on BOTH observers of the same identity', () => {
    const { room } = fakeEventRoom();
    room.addParticipant('p-2', { getTrackPublication: (() => ({ isMuted: false, track: { id: 'cam' } })) as unknown as Participant['getTrackPublication'] });
    const wrapper = roomWrapper(room);

    const a = renderHook(() => useParticipantMedia('p-2'), { wrapper });
    const b = renderHook(() => useParticipantMedia('p-2'), { wrapper });
    expect(a.result.current.cameraTrack).toEqual({ id: 'cam' });
    expect(b.result.current.cameraTrack).toEqual({ id: 'cam' });

    room.addParticipant('p-2', { getTrackPublication: () => undefined });
    act(() => { room.emit('trackUnpublished'); });
    expect(a.result.current.cameraTrack).toBeNull();
    expect(b.result.current.cameraTrack).toBeNull();
  });
});

describe('useConnectionQuality — same shared subscription', () => {
  it('two instances watching the SAME identity register a single ConnectionQualityChanged listener', () => {
    const { room, on, off } = fakeEventRoom();
    const wrapper = roomWrapper(room);

    const a = renderHook(() => useConnectionQuality('p-2'), { wrapper });
    const onCallsAfterFirst = on.mock.calls.length;
    expect(onCallsAfterFirst).toBe(1);

    const b = renderHook(() => useConnectionQuality('p-2'), { wrapper });
    expect(on.mock.calls.length).toBe(onCallsAfterFirst);

    a.unmount();
    expect(off).not.toHaveBeenCalled();
    b.unmount();
    expect(off).toHaveBeenCalledTimes(1);
  });

  it("reflects the participant's real quality and reacts to changes", () => {
    const { room } = fakeEventRoom();
    room.addParticipant('p-2', { connectionQuality: ConnectionQuality.Good });
    const wrapper = roomWrapper(room);

    const { result } = renderHook(() => useConnectionQuality('p-2'), { wrapper });
    expect(result.current).toBe(ConnectionQuality.Good);

    room.addParticipant('p-2', { connectionQuality: ConnectionQuality.Poor });
    act(() => { room.emit('connectionQualityChanged'); });
    expect(result.current).toBe(ConnectionQuality.Poor);
  });
});
