import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { RefObject } from 'react';
import { ConnectionQuality, RemoteVideoTrack, RoomEvent, Track } from 'livekit-client';
import type { Participant, Room, Track as LKTrack } from 'livekit-client';

import { useRoom } from '../../state/RoomContext';
import { observeScreenShareVideo } from './screenShareVisibility';
import { screenAudioMatches, screenShareId } from './screenSharePublication';
import type { ScreenWatchState } from './callSubscriptions';

export interface ParticipantMedia {
  screenTrack: LKTrack | null;
  screenAudioTrack: LKTrack | null;
  cameraTrack: LKTrack | null;
  micTrack: LKTrack | null;
  micActivated: boolean;
  micMuted: boolean;
  screenShareId: string | null;
  /** The presenter paused their preview, independently of viewer subscriptions. */
  screenPaused: boolean;
}

const EMPTY_MEDIA: ParticipantMedia = {
  screenTrack: null, screenAudioTrack: null, cameraTrack: null, micTrack: null,
  micActivated: false, micMuted: true, screenShareId: null, screenPaused: false,
};

export function getParticipant(room: Room, identity: string): Participant | undefined {
  return room.localParticipant.identity === identity ? room.localParticipant : room.getParticipantByIdentity(identity);
}

export function activeTrack(participant: Participant, source: Track.Source): LKTrack | null {
  const pub = participant.getTrackPublication(source);
  return pub && !pub.isMuted ? (pub.track ?? null) : null;
}

/** True while a publication exists and isn't muted, but its track hasn't
 * attached yet — e.g. right after a remote participant connects, before
 * subscription finishes. Distinct from "no publication" (camera/share
 * genuinely off) and from "muted" — both of those also return null from
 * `activeTrack`, but only this one means "it's coming, just not here yet". */
export function isTrackPending(participant: Participant, source: Track.Source): boolean {
  const pub = participant.getTrackPublication(source);
  return !!pub && !pub.isMuted && !pub.track;
}

/** A viewer can be unsubscribed while the presenter has their preview paused. */
export function isScreenPaused(participant: Participant): boolean {
  return participant.getTrackPublication(Track.Source.ScreenShare)?.isMuted ?? false;
}

function readMedia(room: Room, identity: string): ParticipantMedia {
  const participant = getParticipant(room, identity);
  if (!participant) return EMPTY_MEDIA;
  const micPub = participant.getTrackPublication(Track.Source.Microphone);
  const screenPub = participant.getTrackPublication(Track.Source.ScreenShare);
  const screenAudioPub = participant.getTrackPublication(Track.Source.ScreenShareAudio);
  return {
    screenTrack: activeTrack(participant, Track.Source.ScreenShare),
    screenAudioTrack: screenAudioMatches(screenPub, screenAudioPub) && !screenAudioPub?.isMuted ? screenAudioPub?.track ?? null : null,
    cameraTrack: activeTrack(participant, Track.Source.Camera),
    micTrack: micPub?.track ?? null,
    micActivated: !!micPub,
    micMuted: micPub ? micPub.isMuted : true,
    screenShareId: screenShareId(screenPub),
    screenPaused: isScreenPaused(participant),
  };
}

const MEDIA_EVENTS = [
  RoomEvent.Connected,
  RoomEvent.Reconnected,
  RoomEvent.TrackPublished,
  RoomEvent.TrackUnpublished,
  RoomEvent.TrackSubscribed,
  RoomEvent.TrackUnsubscribed,
  RoomEvent.LocalTrackPublished,
  RoomEvent.LocalTrackUnpublished,
  RoomEvent.TrackMuted,
  RoomEvent.TrackUnmuted,
  RoomEvent.ParticipantConnected,
  RoomEvent.ParticipantDisconnected,
];

interface StoreEntry<T> {
  value: T;
  listeners: Set<() => void>;
  teardown: () => void;
}

/** Share one LiveKit subscription per room and identity to avoid duplicate room listeners. */
function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const keys = Object.keys(a) as (keyof T)[];
  return keys.length === Object.keys(b).length && keys.every((key) => Object.is(a[key], b[key]));
}

function createPerIdentityStore<T>(compute: (room: Room, identity: string) => T, events: RoomEvent[]) {
  const byRoom = new WeakMap<Room, Map<string, StoreEntry<T>>>();

  function subscribe(room: Room, identity: string, callback: () => void): () => void {
    let byIdentity = byRoom.get(room);
    if (!byIdentity) { byIdentity = new Map(); byRoom.set(room, byIdentity); }
    let entry = byIdentity.get(identity);
    if (!entry) {
      const listeners = new Set<() => void>();
      const refresh = () => {
        const next = compute(room, identity);
        if (Object.is(next, entry!.value)) return;
        entry!.value = next;
        for (const l of listeners) l();
      };
      for (const ev of events) room.on(ev, refresh);
      entry = { value: compute(room, identity), listeners, teardown: () => { for (const ev of events) room.off(ev, refresh); } };
      byIdentity.set(identity, entry);
    }
    entry.listeners.add(callback);
    return () => {
      entry!.listeners.delete(callback);
      if (entry!.listeners.size === 0) {
        entry!.teardown();
        byIdentity!.delete(identity);
      }
    };
  }

  // Reads with no subscriber yet — a component's first render, before React
  // calls `subscribe` — still have to return the same value for the same
  // state: React asks twice to check, and a fresh object each time is what it
  // warns about (and, if the snapshot truly changed every call, would loop on).
  const unsubscribed = new WeakMap<Room, Map<string, T>>();

  // Never creates the room-level subscription itself (that's `subscribe`'s
  // job alone) — a pure read, falling back to a compute when no subscriber
  // has registered yet.
  function getSnapshot(room: Room, identity: string): T {
    const live = byRoom.get(room)?.get(identity);
    if (live) return live.value;
    let byIdentity = unsubscribed.get(room);
    if (!byIdentity) { byIdentity = new Map(); unsubscribed.set(room, byIdentity); }
    const previous = byIdentity.get(identity);
    const next = compute(room, identity);
    if (previous !== undefined && shallowEqual(previous, next)) return previous;
    byIdentity.set(identity, next);
    return next;
  }

  return { subscribe, getSnapshot };
}

const mediaStore = createPerIdentityStore(readMedia, MEDIA_EVENTS);

export function useParticipantMedia(identity: string): ParticipantMedia {
  const { livekitRoom } = useRoom('livekitRoom');
  // Both callbacks MUST stay referentially stable across renders (not fresh
  // closures every time) — otherwise React treats "subscribe changed" as a
  // reason to unsubscribe/resubscribe on every render, and since `readMedia`
  // allocates a new object each call, that churn looks like "the snapshot
  // changed" forever: an infinite re-render loop, not just wasted work.
  const subscribe = useCallback((callback: () => void) => mediaStore.subscribe(livekitRoom, identity, callback), [livekitRoom, identity]);
  const getSnapshot = useCallback(() => mediaStore.getSnapshot(livekitRoom, identity), [livekitRoom, identity]);
  return useSyncExternalStore(subscribe, getSnapshot);
}

const ignoreScreenWatch = () => () => {};

export function useScreenWatchState(participantId: string | null, shareId: string | null): ScreenWatchState {
  const { callSubscriptions } = useRoom('callSubscriptions');
  const getSnapshot = useCallback(
    () => participantId && shareId ? callSubscriptions.screenState(participantId, shareId) : 'available',
    [callSubscriptions, participantId, shareId],
  );
  return useSyncExternalStore(participantId && shareId ? callSubscriptions.subscribe : ignoreScreenWatch, getSnapshot);
}

const SPEAKING_THRESHOLD = 0.02;
const SPEAKING_RELEASE_MS = 250;

let sharedAudioContext: AudioContext | null = null;
function getAudioContext(): AudioContext {
  if (!sharedAudioContext) sharedAudioContext = new AudioContext();
  return sharedAudioContext;
}

export function useTrackSpeaking(track: LKTrack | null, muted: boolean): boolean {
  const [isSpeaking, setIsSpeaking] = useState(false);

  useEffect(() => {
    if (!track || muted) { setIsSpeaking(false); return; }
    const mediaStreamTrack = track.mediaStreamTrack;
    if (!mediaStreamTrack) return;

    const ctx = getAudioContext();
    ctx.resume().catch(() => {});
    const source = ctx.createMediaStreamSource(new MediaStream([mediaStreamTrack]));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);

    let rafId: number;
    let lastAboveAt = 0;
    function tick() {
      analyser.getByteTimeDomainData(data);
      let sumSquares = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sumSquares += v * v;
      }
      const rms = Math.sqrt(sumSquares / data.length);
      const now = performance.now();
      if (rms > SPEAKING_THRESHOLD) lastAboveAt = now;
      setIsSpeaking(now - lastAboveAt < SPEAKING_RELEASE_MS);
      rafId = requestAnimationFrame(tick);
    }
    tick();

    return () => {
      cancelAnimationFrame(rafId);
      source.disconnect();
      analyser.disconnect();
    };
  }, [track, muted]);

  return isSpeaking;
}

export function useIsSpeaking(identity: string): boolean {
  const media = useParticipantMedia(identity);
  return useTrackSpeaking(media.micTrack, media.micMuted);
}

function readConnectionQuality(room: Room, identity: string): ConnectionQuality {
  return getParticipant(room, identity)?.connectionQuality ?? ConnectionQuality.Unknown;
}

const qualityStore = createPerIdentityStore(readConnectionQuality, [RoomEvent.ConnectionQualityChanged]);

/** Tracks a participant's connection quality straight from the LiveKit room
 * — everyone in a call is already in the same LiveKit room, so this needs no
 * relay through the app's own WebSocket (unlike mic/camera/speaking state,
 * which the server mirrors for participants who haven't joined LiveKit yet).
 * `ConnectionQualityChanged` fires for ANY participant, not scoped to one —
 * shared per identity like `useParticipantMedia`, so a person's camera AND
 * screen tile (2 watchers, same identity) don't each register their own
 * room-wide listener for it. */
export function useConnectionQuality(identity: string): ConnectionQuality {
  const { livekitRoom } = useRoom('livekitRoom');
  const subscribe = useCallback((callback: () => void) => qualityStore.subscribe(livekitRoom, identity, callback), [livekitRoom, identity]);
  const getSnapshot = useCallback(() => qualityStore.getSnapshot(livekitRoom, identity), [livekitRoom, identity]);
  return useSyncExternalStore(subscribe, getSnapshot);
}

export function useAttachTrack(track: LKTrack | null, elRef: RefObject<HTMLMediaElement | null>): void {
  useEffect(() => {
    const el = elRef.current;
    if (!el || !track) return;
    if (track instanceof RemoteVideoTrack && track.source === Track.Source.ScreenShare && el instanceof HTMLVideoElement) {
      observeScreenShareVideo(track, el);
    }
    track.attach(el);
    return () => { track.detach(el); };
  }, [track, elRef]);
}
