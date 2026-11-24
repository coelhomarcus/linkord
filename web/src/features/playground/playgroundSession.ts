import { useSyncExternalStore } from 'react';
import { ConnectionState, RoomEvent } from 'livekit-client';
import type { RemoteParticipant, Room } from 'livekit-client';
import type { AudioHandle } from '@/state/RoomContext';
import { clearSpatialGain, setSpatialGain } from '@/features/calls/participantVolume';
import { decodeState, encodeState, PLAYGROUND_TOPIC, SKIN_TOPIC } from './playgroundProtocol';
import { decodeSkin, loadSavedSkin, MAX_SKIN_BYTES, saveSkin } from './skins/skins';
import type { Skin } from './skins/skins';
import type { PlayerState } from './playgroundProtocol';
import { proximityGain } from './proximity';
import { spawnPoint } from './playgroundWorld';

// Everything a playground call needs while you are in it, whether or not its
// 3D view is on screen: where you stand, where everyone else last said they
// stand, sending your position to them and hearing them by distance. The view
// (PlaygroundStage) comes and goes as you browse the app; this lives as long as
// the call (PlaygroundLayer), so walking off to read a channel neither freezes
// you for the others nor turns everyone up to full volume.
//
// Skins travel the same way, as reliable packets of at most MAX_SKIN_BYTES:
// yours to everyone when you arrive, again to each newcomer, and whenever you
// change it. An empty packet means "my account's default".

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
  private readonly skins = new Map<string, Skin>();
  private readonly skinListeners = new Set<() => void>();
  private localSkinBytes: Uint8Array<ArrayBuffer> | null = loadSavedSkin();
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
    this.local = { ...spawn, pitch: 0, motion: 'idle' };
    if (this.localSkinBytes) void this.adoptSkin(localId, this.localSkinBytes);
  }

  start(): void {
    this.room.on(RoomEvent.DataReceived, this.onData);
    this.room.on(RoomEvent.ParticipantConnected, this.onParticipantConnected);
    this.timer = setInterval(this.tick, AUDIO_TICK_MS);
    this.send(true);
    this.sendSkin();
  }

  dispose(): void {
    this.room.off(RoomEvent.DataReceived, this.onData);
    this.room.off(RoomEvent.ParticipantConnected, this.onParticipantConnected);
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const handle of this.audio.current.values()) clearSpatialGain(handle.element);
    this.skinListeners.clear();
  }

  /** The skin someone chose, or null for their account's default. */
  skinOf(participantId: string): Skin | null {
    return this.skins.get(participantId) ?? null;
  }

  onSkinsChange(listener: () => void): () => void {
    this.skinListeners.add(listener);
    return () => { this.skinListeners.delete(listener); };
  }

  /** Wears a skin (a PNG already checked by decodeSkin/encodeSkin), or the default with null. */
  setLocalSkin(bytes: Uint8Array<ArrayBuffer> | null, skin: Skin | null): void {
    this.localSkinBytes = bytes;
    saveSkin(bytes);
    if (skin) this.skins.set(this.localId, skin);
    else this.skins.delete(this.localId);
    this.notifySkins();
    this.sendSkin();
  }

  private notifySkins(): void {
    for (const listener of this.skinListeners) listener();
  }

  private sendSkin(to?: string): void {
    if (this.room.state !== ConnectionState.Connected) return;
    const payload = this.localSkinBytes ?? new Uint8Array(0);
    this.room.localParticipant.publishData(payload, { reliable: true, topic: SKIN_TOPIC, ...(to ? { destinationIdentities: [to] } : {}) }).catch(() => {});
  }

  private async adoptSkin(participantId: string, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
    try {
      const skin = await decodeSkin(new Blob([bytes], { type: 'image/png' }));
      this.skins.set(participantId, skin);
      this.notifySkins();
    } catch {
      // not a skin after all: they keep their default
    }
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
    for (const id of this.skins.keys()) if (id !== this.localId && !keep.has(id)) this.skins.delete(id);
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

  private onSkinPacket(participantId: string, payload: Uint8Array): void {
    if (payload.byteLength === 0) {
      if (this.skins.delete(participantId)) this.notifySkins();
      return;
    }
    if (payload.byteLength > MAX_SKIN_BYTES) return;
    void this.adoptSkin(participantId, new Uint8Array(payload));
  }

  private onData = (payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string): void => {
    if (!participant) return;
    if (topic === SKIN_TOPIC) {
      this.onSkinPacket(participant.identity, payload);
      return;
    }
    if (topic !== PLAYGROUND_TOPIC) return;
    const state = decodeState(payload);
    if (state) this.remotes.set(participant.identity, { state, receivedAt: performance.now() });
  };

  private onParticipantConnected = (participant: RemoteParticipant): void => {
    this.send(true);
    this.sendSkin(participant.identity);
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
