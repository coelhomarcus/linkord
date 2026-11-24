import { useSyncExternalStore } from 'react';
import { ConnectionState, RoomEvent } from 'livekit-client';
import type { RemoteParticipant, Room } from 'livekit-client';
import type { AudioHandle } from '@/state/RoomContext';
import { clearSpatialGain, setSpatialGain } from '@/features/calls/participantVolume';
import { decodeState, encodeState, PLAYGROUND_TOPIC } from './playgroundProtocol';
import type { PlayerState } from './playgroundProtocol';
import { proximityGain } from './proximity';
import { spawnPoint } from './playgroundWorld';

// Everything a playground call needs while you are in it, whether or not its
// 3D view is on screen: where you stand, where everyone else last said they
// stand, sending your position to them and hearing them by distance. The view
// (PlaygroundStage) comes and goes as you browse the app; this lives as long as
// the call (PlaygroundLayer), so walking off to read a channel neither freezes
// you for the others nor turns everyone up to full volume.

// a moving avatar is sent at most this often...
const SEND_INTERVAL_MS = 66;
// ...and a still one this often, so someone who just arrived sees it
const HEARTBEAT_MS = 1000;
const AUDIO_TICK_MS = 100;

export interface RemotePlayer {
  state: PlayerState;
  receivedAt: number;
}

export class PlaygroundSession {
  local: PlayerState;
  readonly remotes = new Map<string, RemotePlayer>();
  private lastSentAt = 0;
  private lastSentKey = '';
  private timer: ReturnType<typeof setInterval> | null = null;

  private readonly room: Room;
  readonly conversationId: string;
  readonly localId: string;
  private readonly audio: { current: Map<string, AudioHandle> };

  constructor(room: Room, conversationId: string, localId: string, audio: { current: Map<string, AudioHandle> }) {
    this.room = room;
    this.conversationId = conversationId;
    this.localId = localId;
    this.audio = audio;
    const spawn = spawnPoint(localId);
    this.local = { ...spawn, motion: 'idle' };
  }

  start(): void {
    this.room.on(RoomEvent.DataReceived, this.onData);
    this.room.on(RoomEvent.ParticipantConnected, this.onParticipantConnected);
    this.timer = setInterval(this.tick, AUDIO_TICK_MS);
    this.send(true);
  }

  dispose(): void {
    this.room.off(RoomEvent.DataReceived, this.onData);
    this.room.off(RoomEvent.ParticipantConnected, this.onParticipantConnected);
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const handle of this.audio.current.values()) clearSpatialGain(handle.element);
  }

  /** The 3D view reports the local avatar every frame; sending is throttled here. */
  setLocal(state: PlayerState): void {
    this.local = state;
    this.send(false);
  }

  /** Drops what is known about anyone no longer in the call. */
  retain(participantIds: readonly string[]): void {
    const keep = new Set(participantIds);
    for (const id of this.remotes.keys()) if (!keep.has(id)) this.remotes.delete(id);
  }

  private send(force: boolean): void {
    const now = performance.now();
    const key = `${this.local.x.toFixed(2)},${this.local.y.toFixed(2)},${this.local.z.toFixed(2)},${this.local.yaw.toFixed(2)},${this.local.motion}`;
    const due = force || now - this.lastSentAt >= HEARTBEAT_MS || (key !== this.lastSentKey && now - this.lastSentAt >= SEND_INTERVAL_MS);
    if (!due || this.room.state !== ConnectionState.Connected) return;
    this.lastSentAt = now;
    this.lastSentKey = key;
    // a full buffer or a lost permission only costs this one packet; the next frame tries again
    this.room.localParticipant.publishData(encodeState(this.local), { reliable: false, topic: PLAYGROUND_TOPIC }).catch(() => {});
  }

  private onData = (payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string): void => {
    if (topic !== PLAYGROUND_TOPIC || !participant) return;
    const state = decodeState(payload);
    if (state) this.remotes.set(participant.identity, { state, receivedAt: performance.now() });
  };

  private onParticipantConnected = (): void => {
    this.send(true);
  };

  private tick = (): void => {
    this.send(false);
    for (const [key, handle] of this.audio.current) {
      // `<id>:screen` is a stream's own sound: the big screen is for everyone, wherever they stand
      if (key.includes(':')) continue;
      const remote = this.remotes.get(key);
      // someone whose position never arrived (an older app, or the first instant
      // after joining) is heard as in a normal call rather than not at all
      const gain = remote ? proximityGain(Math.hypot(remote.state.x - this.local.x, remote.state.y - this.local.y, remote.state.z - this.local.z)) : 1;
      setSpatialGain(handle.element, gain);
    }
  };
}

let active: PlaygroundSession | null = null;
const listeners = new Set<() => void>();

export function setActivePlaygroundSession(session: PlaygroundSession | null): void {
  active = session;
  for (const listener of listeners) listener();
}

export function getActivePlaygroundSession(): PlaygroundSession | null {
  return active;
}

export function subscribeToPlaygroundSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The session of the playground call you are in, or null outside one. */
export function usePlaygroundSession(): PlaygroundSession | null {
  return useSyncExternalStore(subscribeToPlaygroundSession, getActivePlaygroundSession);
}
