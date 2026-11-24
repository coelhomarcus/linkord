import { useSyncExternalStore } from 'react';
import { ConnectionState, RoomEvent } from 'livekit-client';
import type { RemoteParticipant, Room } from 'livekit-client';
import type { AudioHandle } from '@/state/RoomContext';
import type { ClientMessage, ServerMessage } from '@/shared/types/protocol';
import { clearSpatialGain, setSpatialGain } from '@/features/calls/participantVolume';
import { decodeState, encodeState, PLAYGROUND_TOPIC, SKIN_TOPIC } from './playgroundProtocol';
import { fetchAccountSkin, forgetLegacySkin, saveAccountSkin, takeLegacySkin } from './skins/accountSkin';
import { decodeSkin, MAX_SKIN_BYTES } from './skins/skins';
import type { Skin } from './skins/skins';
import type { PlayerState } from './playgroundProtocol';
import { proximityGain } from './proximity';
import { spawnPoint } from './playgroundWorld';
import { PlaygroundCombat } from './playgroundCombat';

// Everything a playground call needs while you are in it, whether or not its
// 3D view is on screen: where you stand, where everyone else last said they
// stand, sending your position to them and hearing them by distance. The view
// (PlaygroundStage) comes and goes as you browse the app; this lives as long as
// the call (PlaygroundLayer), so walking off to read a channel neither freezes
// you for the others nor turns everyone up to full volume.
//
// Skins are kept with each account (skins/accountSkin.ts) and read from the
// server for everyone who shows up in the call, so a reload, a late join or a
// packet that never arrived cannot leave anyone in someone else's default.
// A change is also sent to the others as a reliable packet of at most
// MAX_SKIN_BYTES (an empty one meaning "my account's default"), after it is
// saved: that is only the fast path, and what older tabs still listen for.
//
// Fighting is the server's (playgroundCombat.ts): the session also reports
// your position to it over the socket, less often than to the others, sends
// your punches and passes on what the server says about health.

// a moving avatar is sent at most this often...
const SEND_INTERVAL_MS = 66;
// ...and a still one this often, so someone who just arrived sees it
const HEARTBEAT_MS = 1000;
const AUDIO_TICK_MS = 100;
// a skin that could not be read (a network blip) is asked for again after this
const SKIN_RETRY_MS = 5000;
// the server only needs your position to measure a punch's reach (6 blocks of leeway)
const SERVER_REPORT_MS = 150;

/** Someone in the call, by connection and by account. */
export interface PlaygroundMember {
  id: string;
  userId: string;
}

export interface RemotePlayer {
  state: PlayerState;
  receivedAt: number;
}

export class PlaygroundSession {
  local: PlayerState;
  readonly remotes = new Map<string, RemotePlayer>();
  /** chosen skins by account id; no entry is the account's default */
  private readonly skins = new Map<string, Skin>();
  private readonly skinListeners = new Set<() => void>();
  /** which account each connection in the call belongs to */
  private readonly members = new Map<string, string>();
  /** accounts whose skin was read, or is being read */
  private readonly skinRequested = new Set<string>();
  /** bumped by every newer skin of an account, so an older read or decode that finishes late is dropped */
  private readonly skinVersions = new Map<string, number>();
  private readonly retryTimers = new Set<ReturnType<typeof setTimeout>>();
  private localSkinBytes: Uint8Array<ArrayBuffer> | null = null;
  private localSkinChange = 0;
  private disposed = false;
  private lastSentAt = 0;
  private lastSentKey = '';
  private lastReportedAt = 0;
  private lastReportedKey = '';
  /** the next report asks the server for everyone's health, until one goes out */
  private askHealth = true;
  readonly combat: PlaygroundCombat;
  private timer: ReturnType<typeof setInterval> | null = null;

  private readonly room: Room;
  readonly conversationId: string;
  readonly localId: string;
  readonly localUserId: string;
  private readonly audio: { current: Map<string, AudioHandle> };
  private readonly sendWs: (msg: ClientMessage) => boolean;

  constructor(
    room: Room, conversationId: string, localId: string, localUserId: string, audio: { current: Map<string, AudioHandle> },
    sendWs: (msg: ClientMessage) => boolean = () => false,
  ) {
    this.room = room;
    this.conversationId = conversationId;
    this.localId = localId;
    this.localUserId = localUserId;
    this.audio = audio;
    this.sendWs = sendWs;
    this.combat = new PlaygroundCombat(localId);
    const spawn = spawnPoint(localId);
    this.local = { ...spawn, pitch: 0, motion: 'idle', headYaw: spawn.yaw, crouch: false, swings: 0 };
  }

  start(): void {
    this.room.on(RoomEvent.DataReceived, this.onData);
    this.room.on(RoomEvent.ParticipantConnected, this.onParticipantConnected);
    this.room.on(RoomEvent.Connected, this.onConnected);
    this.room.on(RoomEvent.Reconnected, this.onConnected);
    this.timer = setInterval(this.tick, AUDIO_TICK_MS);
    this.send(true);
    this.report();
    void this.loadLocalSkin();
  }

  dispose(): void {
    this.disposed = true;
    this.room.off(RoomEvent.DataReceived, this.onData);
    this.room.off(RoomEvent.ParticipantConnected, this.onParticipantConnected);
    this.room.off(RoomEvent.Connected, this.onConnected);
    this.room.off(RoomEvent.Reconnected, this.onConnected);
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const timer of this.retryTimers) clearTimeout(timer);
    this.retryTimers.clear();
    for (const handle of this.audio.current.values()) clearSpatialGain(handle.element);
    this.skinListeners.clear();
    this.combat.dispose();
  }

  /** A punch that landed on someone, as this client saw it; the server decides whether it counts. */
  attack(targetId: string, crit: boolean, sprint: boolean): void {
    if (this.combat.isDead) return;
    const { x, y, z, headYaw } = this.local;
    this.sendWs({ t: 'playground-attack', targetId, x, y, z, yaw: headYaw, crit, sprint });
  }

  /** Back to life, once dead; the server answers with the health. */
  respawn(): void {
    this.sendWs({ t: 'playground-respawn' });
  }

  /** What the server says about this call's fighting (RoomProvider passes it on). */
  receive(message: Extract<ServerMessage, { t: 'playground-hit' | 'playground-health' }>): void {
    if (message.conversationId === this.conversationId && !this.disposed) this.combat.receive(message);
  }

  /** The skin an account chose, or null for its default. */
  skinOf(userId: string): Skin | null {
    return this.skins.get(userId) ?? null;
  }

  onSkinsChange(listener: () => void): () => void {
    this.skinListeners.add(listener);
    return () => { this.skinListeners.delete(listener); };
  }

  /** Wears a skin (a PNG already checked by decodeSkin/encodeSkin), or the default with null. It shows
   * at once and is saved to the account; if the server refuses, the previous one comes back and this throws. */
  async setLocalSkin(bytes: Uint8Array<ArrayBuffer> | null, skin: Skin | null): Promise<void> {
    const previous = { bytes: this.localSkinBytes, skin: this.skins.get(this.localUserId) ?? null };
    const change = ++this.localSkinChange;
    this.bumpSkinVersion(this.localUserId);
    this.wearLocal(bytes, skin);
    try {
      await saveAccountSkin(bytes);
    } catch (err) {
      if (change === this.localSkinChange && !this.disposed) this.wearLocal(previous.bytes, previous.skin);
      throw err;
    }
    if (change === this.localSkinChange) this.sendSkin();
  }

  private wearLocal(bytes: Uint8Array<ArrayBuffer> | null, skin: Skin | null): void {
    this.localSkinBytes = bytes;
    this.setSkin(this.localUserId, skin);
  }

  private setSkin(userId: string, skin: Skin | null): void {
    if (skin) this.skins.set(userId, skin);
    else if (!this.skins.delete(userId)) return;
    this.notifySkins();
  }

  private notifySkins(): void {
    for (const listener of this.skinListeners) listener();
  }

  private bumpSkinVersion(userId: string): number {
    const version = (this.skinVersions.get(userId) ?? 0) + 1;
    this.skinVersions.set(userId, version);
    return version;
  }

  private isCurrent(userId: string, version: number): boolean {
    return !this.disposed && this.skinVersions.get(userId) === version;
  }

  /** Your own skin, from the account; one only this browser had (from before) is moved there. */
  private async loadLocalSkin(): Promise<void> {
    const userId = this.localUserId;
    const version = this.bumpSkinVersion(userId);
    const legacy = takeLegacySkin();
    let stored: Uint8Array<ArrayBuffer> | null;
    try {
      stored = await fetchAccountSkin(userId);
    } catch {
      if (this.isCurrent(userId, version)) this.retry(() => void this.loadLocalSkin());
      return;
    }
    if (!this.isCurrent(userId, version)) return;
    if (!stored && legacy) {
      const skin = await this.decode(legacy);
      if (!this.isCurrent(userId, version)) return;
      if (!skin) {
        forgetLegacySkin();
        return;
      }
      try {
        await this.setLocalSkin(legacy, skin);
        forgetLegacySkin();
      } catch {
        // kept in this browser, to be moved on the next try
      }
      return;
    }
    if (legacy) forgetLegacySkin();
    const skin = stored ? await this.decode(stored) : null;
    if (!this.isCurrent(userId, version)) return;
    this.wearLocal(skin ? stored : null, skin);
    this.sendSkin();
  }

  /** Someone else's skin, from their account. */
  private async loadSkin(userId: string): Promise<void> {
    const version = this.bumpSkinVersion(userId);
    this.skinRequested.add(userId);
    let stored: Uint8Array<ArrayBuffer> | null;
    try {
      stored = await fetchAccountSkin(userId);
    } catch {
      if (!this.isCurrent(userId, version)) return;
      // asked for again by the next roster change, or by the retry if none comes
      this.skinRequested.delete(userId);
      this.retry(() => { if (this.isMember(userId) && !this.skinRequested.has(userId)) void this.loadSkin(userId); });
      return;
    }
    const skin = stored ? await this.decode(stored) : null;
    if (this.isCurrent(userId, version)) this.setSkin(userId, skin);
  }

  private retry(run: () => void): void {
    if (this.disposed) return;
    const timer = setTimeout(() => {
      this.retryTimers.delete(timer);
      if (!this.disposed) run();
    }, SKIN_RETRY_MS);
    this.retryTimers.add(timer);
  }

  private isMember(userId: string): boolean {
    for (const id of this.members.values()) if (id === userId) return true;
    return false;
  }

  private async decode(bytes: Uint8Array<ArrayBuffer>): Promise<Skin | null> {
    try {
      return await decodeSkin(new Blob([bytes], { type: 'image/png' }));
    } catch {
      // not a skin after all: the default stands in
      return null;
    }
  }

  private sendSkin(to?: string): void {
    if (this.room.state !== ConnectionState.Connected) return;
    const payload = this.localSkinBytes ?? new Uint8Array(0);
    this.room.localParticipant.publishData(payload, { reliable: true, topic: SKIN_TOPIC, ...(to ? { destinationIdentities: [to] } : {}) }).catch(() => {});
  }

  /** The 3D view reports the local avatar every frame; sending is throttled here. */
  setLocal(state: PlayerState): void {
    this.local = state;
    this.send(false);
    this.report();
  }

  /** Who is in the call now: reads the skin of anyone new and drops what is known about anyone gone. */
  retain(members: readonly PlaygroundMember[]): void {
    const keep = new Set(members.map((member) => member.id));
    for (const id of this.remotes.keys()) if (!keep.has(id)) this.remotes.delete(id);
    this.members.clear();
    for (const member of members) if (member.id !== this.localId) this.members.set(member.id, member.userId);
    const accounts = new Set(this.members.values());
    for (const userId of accounts) {
      if (userId !== this.localUserId && !this.skinRequested.has(userId)) void this.loadSkin(userId);
    }
    for (const userId of [...this.skinRequested]) {
      if (accounts.has(userId)) continue;
      this.skinRequested.delete(userId);
      // a read still on its way is dropped too
      this.bumpSkinVersion(userId);
      this.setSkin(userId, null);
    }
  }

  private send(force: boolean): void {
    const now = performance.now();
    const { x, y, z, yaw, headYaw, pitch, motion, crouch, swings } = this.local;
    const key = `${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)},${yaw.toFixed(2)},${headYaw.toFixed(2)},${pitch.toFixed(2)},${motion},${crouch},${swings}`;
    const due = force || now - this.lastSentAt >= HEARTBEAT_MS || (key !== this.lastSentKey && now - this.lastSentAt >= SEND_INTERVAL_MS);
    if (!due || this.room.state !== ConnectionState.Connected) return;
    this.lastSentAt = now;
    this.lastSentKey = key;
    // a full buffer or a lost permission only costs this one packet; the next frame tries again
    this.room.localParticipant.publishData(encodeState(this.local), { reliable: false, topic: PLAYGROUND_TOPIC }).catch(() => {});
  }

  private report(): void {
    const now = performance.now();
    const { x, y, z, headYaw } = this.local;
    const key = `${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)},${headYaw.toFixed(2)}`;
    const due = this.askHealth || now - this.lastReportedAt >= HEARTBEAT_MS || (key !== this.lastReportedKey && now - this.lastReportedAt >= SERVER_REPORT_MS);
    if (!due) return;
    const sent = this.sendWs({ t: 'playground-pos', x, y, z, yaw: headYaw, ...(this.askHealth ? { first: true } : {}) });
    if (!sent) return;
    this.lastReportedAt = now;
    this.lastReportedKey = key;
    this.askHealth = false;
  }

  /** A change someone just saved. From a connection not yet in the roster it is ignored: the read
   * when they show up there finds the same skin, since it is saved before it is sent. */
  private async onSkinPacket(participantId: string, payload: Uint8Array): Promise<void> {
    const userId = this.members.get(participantId);
    if (!userId || userId === this.localUserId || payload.byteLength > MAX_SKIN_BYTES) return;
    const version = this.bumpSkinVersion(userId);
    this.skinRequested.add(userId);
    const skin = payload.byteLength === 0 ? null : await this.decode(new Uint8Array(payload));
    if (this.isCurrent(userId, version)) this.setSkin(userId, skin);
  }

  private onData = (payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string): void => {
    if (!participant) return;
    if (topic === SKIN_TOPIC) {
      void this.onSkinPacket(participant.identity, payload);
      return;
    }
    if (topic !== PLAYGROUND_TOPIC) return;
    const state = decodeState(payload);
    if (state) this.remotes.set(participant.identity, { state, receivedAt: performance.now() });
  };

  private onParticipantConnected = (participant: RemoteParticipant): void => {
    this.send(true);
    // newer tabs read it from the server; older ones still wait for this
    this.sendSkin(participant.identity);
  };

  // the data channel only opens once connected: what was due before then goes out now
  private onConnected = (): void => {
    this.send(true);
    this.sendSkin();
  };

  private tick = (): void => {
    this.send(false);
    this.report();
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

function subscribeToPlaygroundSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The session of the playground call you are in, or null outside one. */
export function usePlaygroundSession(): PlaygroundSession | null {
  return useSyncExternalStore(subscribeToPlaygroundSession, getActivePlaygroundSession);
}
