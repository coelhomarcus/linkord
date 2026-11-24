import { useSyncExternalStore } from 'react';
import { ConnectionState, RoomEvent } from 'livekit-client';
import type { RemoteParticipant, Room } from 'livekit-client';
import type { AudioHandle } from '@/state/RoomContext';
import type { ClientMessage } from '@/shared/types/protocol';
import { clearSpatialGain, setSpatialGain } from '@/features/calls/participantVolume';
import { decodeState, encodeState, PLAYGROUND_TOPIC, SKIN_TOPIC } from './playgroundProtocol';
import { fetchAccountSkin, forgetLegacySkin, saveAccountSkin, takeLegacySkin } from './skins/accountSkin';
import { decodeSkin, MAX_SKIN_BYTES } from './skins/skins';
import type { Skin } from './skins/skins';
import type { PlayerState } from './playgroundProtocol';
import { proximityGain } from './proximity';
import { spawnPoint } from '@game/layout';
import { heldBlock, openContainer, useHeld, wearHeld } from '@game/inventory';
import type { InventoryOp } from '@game/inventory';
import { BLOCK, isReplaceable } from '@game/blocks';
import type { Block } from '@game/blocks';
import { brokenInto, wearForBreaking } from '@game/mining';
import { inflateBlocks, WorldState } from './worldState';
import { PlaygroundCombat } from './playgroundCombat';
import { PlaygroundLink } from './playgroundLink';
import type { LinkStatus, ServiceLink, ServiceLinkOptions, PlaygroundServerMessage, PlaygroundTokenReply } from './playgroundLink';
import { InventoryState, readSnapshot } from './inventory/inventory';

// Everything a playground call needs while you are in it, whether or not its
// 3D view is on screen: where you stand, where everyone else last said they
// stand, sending your position to them and hearing them by distance. The view
// (PlaygroundStage) comes and goes as you browse the app; this lives as long as
// the call (PlaygroundLayer), so walking off to read a channel neither freezes
// you for the others nor turns everyone up to full volume.
//
// Skins are kept with each account (skins/accountSkin.ts) and read from the
// playground service for everyone who shows up in the call, so a reload, a late
// join or a packet that never arrived cannot leave anyone in someone else's
// default.
// A change is also sent to the others as a reliable packet of at most
// MAX_SKIN_BYTES (an empty one meaning "my account's default"), after it is
// saved: that is only the fast path, and what older tabs still listen for.
//
// Fighting is the playground service's (playgroundCombat.ts, playgroundLink.ts):
// the session also reports your position to it, less often than to the others,
// sends your punches and passes on what it says about health.
//
// So is the world (worldState.ts) and what you carry (inventory/inventory.ts):
// the session reads the world when the link connects, keeps it as the service
// changes it, and sends the blocks you break and place and your clicks in the
// inventory, showing each at once.

// a moving avatar is sent at most this often...
const SEND_INTERVAL_MS = 66;
// ...and a still one this often, so someone who just arrived sees it
const HEARTBEAT_MS = 1000;
const AUDIO_TICK_MS = 100;
// a skin that could not be read (a network blip) is asked for again after this
const SKIN_RETRY_MS = 5000;
// the playground service only needs your position to measure a punch's reach (6 blocks of leeway)
const SERVER_REPORT_MS = 150;

/** Someone in the call, by connection and by account. */
export interface PlaygroundMember {
  id: string;
  userId: string;
}

/** Where getting into the world stands, as the loading screen tells it. */
export type LoadingPhase = 'connecting' | 'unreachable' | 'downloading' | 'worldFailed' | 'building' | 'ready';

export interface Loading {
  phase: LoadingPhase;
  /** how much of the terrain is built, 0..1, while building */
  progress: number;
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
  /** your own skin was read or picked: until then nothing is sent, since an empty packet means "default" */
  private localSkinKnown = false;
  private localSkinChange = 0;
  private disposed = false;
  private lastSentAt = 0;
  private lastSentKey = '';
  private lastReportedAt = 0;
  private lastReportedKey = '';
  /** the next report asks the service for everyone's health, until one goes out */
  private askHealth = true;
  private readonly link: ServiceLink;
  readonly combat: PlaygroundCombat;
  /** what you carry, as the service keeps it */
  readonly inventory = new InventoryState();
  /** the world, as the service sent it */
  readonly world = new WorldState();
  /** bumped by each new connection, so a world read for an older one is dropped */
  private linkGeneration = 0;
  private loading: Loading = { phase: 'connecting', progress: 0 };
  private readonly loadingListeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;

  private readonly room: Room;
  readonly conversationId: string;
  readonly localId: string;
  readonly localUserId: string;
  private readonly audio: { current: Map<string, AudioHandle> };

  constructor(
    room: Room, conversationId: string, localId: string, localUserId: string, audio: { current: Map<string, AudioHandle> },
    sendWs: (msg: ClientMessage) => boolean = () => false,
    createLink: (options: ServiceLinkOptions) => ServiceLink = (options) => new PlaygroundLink(options),
  ) {
    this.room = room;
    this.conversationId = conversationId;
    this.localId = localId;
    this.localUserId = localUserId;
    this.audio = audio;
    this.combat = new PlaygroundCombat(localId);
    this.link = createLink({
      conversationId,
      requestToken: () => sendWs({ t: 'playground-token', conversationId }),
      onMessage: (message) => this.receive(message),
      // a new connection to the service (a first one, or after it restarted) hears everyone's health again
      onConnect: () => {
        this.askHealth = true;
        this.report();
        this.inventory.forgetPending();
        void this.loadWorld(++this.linkGeneration);
      },
      onStatus: (status) => this.linkStatus(status),
    });
    const spawn = spawnPoint(localId);
    this.local = { ...spawn, pitch: 0, motion: 'idle', headYaw: spawn.yaw, crouch: false, swings: 0 };
  }

  start(): void {
    this.room.on(RoomEvent.DataReceived, this.onData);
    this.room.on(RoomEvent.ParticipantConnected, this.onParticipantConnected);
    this.room.on(RoomEvent.Connected, this.onConnected);
    this.room.on(RoomEvent.Reconnected, this.onConnected);
    this.timer = setInterval(this.tick, AUDIO_TICK_MS);
    this.link.start();
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
    this.loadingListeners.clear();
    this.link.dispose();
    this.combat.dispose();
    this.world.dispose();
  }

  getLoading = (): Loading => this.loading;

  subscribeLoading = (listener: () => void): (() => void) => {
    this.loadingListeners.add(listener);
    return () => { this.loadingListeners.delete(listener); };
  };

  private setLoading(phase: LoadingPhase, progress = 0): void {
    // once in the world, a reconnect does not bring the loading screen back
    if (this.loading.phase === 'ready' || (phase === this.loading.phase && progress === this.loading.progress)) return;
    this.loading = { phase, progress };
    for (const listener of this.loadingListeners) listener();
  }

  private linkStatus(status: LinkStatus): void {
    if (this.world.loaded) return;
    this.setLoading(status === 'connected' ? 'downloading' : status);
  }

  /** The 3D view says how much of the terrain it has built (1: all of it, the world shows). */
  reportBuild(progress: number): void {
    if (this.world.loaded) this.setLoading(progress >= 1 ? 'ready' : 'building', Math.round(progress * 100) / 100);
  }

  /** The world as it is now, from the service (a failed read is tried again a little later). */
  private async loadWorld(generation: number): Promise<void> {
    let answer: Record<string, unknown>;
    let blocks: Uint8Array;
    try {
      answer = await this.link.request({ event: 'world-get', payload: {} });
      const packed = answer.blocks;
      if (!(packed instanceof ArrayBuffer) && !(packed instanceof Uint8Array)) throw new Error('no blocks');
      blocks = await inflateBlocks(packed);
    } catch {
      if (generation !== this.linkGeneration) return;
      if (!this.world.loaded) this.setLoading('worldFailed');
      this.retry(() => { if (generation === this.linkGeneration) void this.loadWorld(generation); });
      return;
    }
    if (this.disposed || generation !== this.linkGeneration) return;
    this.world.load(blocks, answer);
    this.setLoading('building');
  }

  private sendInventoryOp = (seq: number, op: InventoryOp): boolean => this.link.send({ t: 'inv-op', seq, op });

  /** A click, a key or a screen closing in the inventory: shown now, sent to the service. */
  inventoryOp(op: InventoryOp): void {
    this.inventory.perform(op, this.sendInventoryOp);
  }

  /** You started digging a block (the service times the dig). */
  digStart(x: number, y: number, z: number): void {
    this.link.send({ t: 'dig-start', x, y, z });
  }

  /** A block dug out: gone at once here, the held tool worn; the service confirms or puts it back. */
  breakBlock(x: number, y: number, z: number): void {
    const grid = this.world.grid;
    if (!grid) return;
    const block = grid.get(x, y, z);
    const into = brokenInto(grid, x, y, z);
    const sent = this.inventory.predict(
      (window) => ({ ...window, inventory: wearHeld(window.inventory, wearForBreaking(window.inventory.slots[window.inventory.selected]?.item ?? null, block)) }),
      (seq) => this.link.send({ t: 'block-break', seq, x, y, z }),
    );
    if (sent) this.world.predict(x, y, z, into);
  }

  /** The held block put in a cell; false when the hand holds no block or the cell is taken. */
  placeBlock(x: number, y: number, z: number): boolean {
    const grid = this.world.grid;
    const block = heldBlock(this.inventory.get());
    if (!grid || block === null || !isReplaceable(grid.get(x, y, z))) return false;
    const sent = this.inventory.predict(
      (window) => ({ ...window, inventory: useHeld(window.inventory) }),
      (seq) => this.link.send({ t: 'block-place', seq, x, y, z }),
    );
    if (sent) this.world.predict(x, y, z, block as Block);
    return sent;
  }

  /** A crafting table or furnace opened: its screen shows at once, its contents when the service answers. */
  useBlock(x: number, y: number, z: number): boolean {
    const block = this.world.grid?.get(x, y, z);
    if (block !== BLOCK.craftingTable && block !== BLOCK.furnace) return false;
    const kind = block === BLOCK.furnace ? 'furnace' : 'table';
    return this.inventory.predict(
      (window) => openContainer(window.inventory, { kind, x, y, z }).window,
      (seq) => this.link.send({ t: 'block-use', seq, x, y, z }),
    );
  }

  /** A punch that landed on someone, as this client saw it; the service decides whether it counts. */
  attack(targetId: string, crit: boolean, sprint: boolean): void {
    if (this.combat.isDead) return;
    const { x, y, z, headYaw } = this.local;
    this.link.send({ t: 'playground-attack', targetId, x, y, z, yaw: headYaw, crit, sprint });
  }

  /** Back to life, once dead; the service answers with the health. */
  respawn(): void {
    this.link.send({ t: 'playground-respawn' });
  }

  /** What the playground service says about this call: its fighting, its world, your inventory. */
  receive(message: PlaygroundServerMessage): void {
    if (message.conversationId !== this.conversationId || this.disposed) return;
    switch (message.t) {
      case 'playground-blocks': return this.world.applyBlocks(message.changes);
      case 'playground-items': return this.world.applyItems(message);
      case 'playground-furnace': return this.world.applyFurnace(message);
      case 'playground-held': return this.world.applyHeld(message.players);
      case 'playground-inv': {
        const snapshot = readSnapshot(message as unknown as Record<string, unknown>);
        if (snapshot) this.inventory.receive(snapshot);
        return;
      }
      default: this.combat.receive(message);
    }
  }

  /** The app's answer to a pass request (RoomProvider passes it on). */
  receiveToken(reply: PlaygroundTokenReply): void {
    if (!this.disposed) this.link.receiveToken(reply);
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
   * at once and is saved to the account; if the service refuses, the previous one comes back and this throws. */
  async setLocalSkin(bytes: Uint8Array<ArrayBuffer> | null, skin: Skin | null): Promise<void> {
    const previous = { bytes: this.localSkinBytes, skin: this.skins.get(this.localUserId) ?? null };
    const change = ++this.localSkinChange;
    this.bumpSkinVersion(this.localUserId);
    this.wearLocal(bytes, skin);
    try {
      await saveAccountSkin(bytes, this.link);
    } catch (err) {
      if (change === this.localSkinChange && !this.disposed) this.wearLocal(previous.bytes, previous.skin);
      throw err;
    }
    if (change === this.localSkinChange) this.sendSkin();
  }

  private wearLocal(bytes: Uint8Array<ArrayBuffer> | null, skin: Skin | null): void {
    this.localSkinBytes = bytes;
    this.localSkinKnown = true;
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
      stored = await fetchAccountSkin(userId, this.link);
    } catch {
      // asked again only if nothing changed it since: a skin picked meanwhile is newer than any read
      if (this.isCurrent(userId, version)) this.retry(() => { if (this.isCurrent(userId, version)) void this.loadLocalSkin(); });
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
      stored = await fetchAccountSkin(userId, this.link);
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
    if (!this.localSkinKnown || this.room.state !== ConnectionState.Connected) return;
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
    const sent = this.link.send({ t: 'playground-pos', x, y, z, yaw: headYaw, ...(this.askHealth ? { first: true } : {}) });
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

const NOT_LOADED: Loading = { phase: 'connecting', progress: 0 };
const noLoadingSubscription = () => () => {};
const notLoaded = () => NOT_LOADED;

/** Where getting into the world stands (connecting outside a playground). */
export function useLoading(session: PlaygroundSession | null): Loading {
  return useSyncExternalStore(session?.subscribeLoading ?? noLoadingSubscription, session?.getLoading ?? notLoaded);
}

/** The session of the playground call you are in, or null outside one. */
export function usePlaygroundSession(): PlaygroundSession | null {
  return useSyncExternalStore(subscribeToPlaygroundSession, getActivePlaygroundSession);
}
