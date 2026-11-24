import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionState, RoomEvent } from 'livekit-client';
import type { Room } from 'livekit-client';
import { PlaygroundSession } from '@/features/playground/playgroundSession';
import { SKIN_TOPIC } from '@/features/playground/playgroundProtocol';
import { LOCAL_STORAGE_KEYS } from '@/shared/lib/localStorage';
import type { ClientMessage } from '@/shared/types/protocol';
import type { CombatLinkOptions, PlaygroundClientMessage } from '@/features/playground/playgroundLink';

const account = vi.hoisted(() => ({
  stored: new Map<string, Uint8Array | null>(),
  fetchAccountSkin: vi.fn(),
  saveAccountSkin: vi.fn(),
}));

vi.mock('@/features/playground/skins/accountSkin', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchAccountSkin: account.fetchAccountSkin,
  saveAccountSkin: account.saveAccountSkin,
}));

// jsdom has no createImageBitmap: a "PNG" here is one byte, and the skin keeps it to be told apart
vi.mock('@/features/playground/skins/skins', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  decodeSkin: async (blob: Blob) => ({ pixels: new Uint8ClampedArray(await blob.arrayBuffer()), slim: false }),
}));

const png = (n: number) => new Uint8Array([n]);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function fakeRoom() {
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  const publishData = vi.fn(() => Promise.resolve());
  const room = {
    state: ConnectionState.Connected,
    localParticipant: { publishData },
    on: (event: string, fn: (...args: unknown[]) => void) => { if (!handlers.has(event)) handlers.set(event, new Set()); handlers.get(event)!.add(fn); return room; },
    off: (event: string, fn: (...args: unknown[]) => void) => { handlers.get(event)?.delete(fn); return room; },
  };
  const emit = (event: string, ...args: unknown[]) => { for (const fn of handlers.get(event) ?? []) fn(...args); };
  const skinPackets = () => (publishData.mock.calls as unknown as [Uint8Array, { topic: string; destinationIdentities?: string[] }][])
    .filter(([, options]) => options.topic === SKIN_TOPIC).map(([payload, options]) => ({ payload: [...payload], to: options.destinationIdentities }));
  return { room: room as unknown as Room, emit, skinPackets };
}

function startSession() {
  const fake = fakeRoom();
  const session = new PlaygroundSession(fake.room, 'conv', 'conn-me', 'me', { current: new Map() });
  session.start();
  return { session, ...fake };
}

const worn = (session: PlaygroundSession, userId: string) => {
  const skin = session.skinOf(userId);
  return skin ? [...skin.pixels] : null;
};

describe('PlaygroundSession skins', () => {
  beforeEach(() => {
    localStorage.clear();
    account.stored.clear();
    account.fetchAccountSkin.mockReset().mockImplementation(async (userId: string) => account.stored.get(userId) ?? null);
    account.saveAccountSkin.mockReset().mockResolvedValue(undefined);
  });

  it('wears your own skin from the account and sends it once read', async () => {
    account.stored.set('me', png(7));
    const { session, skinPackets } = startSession();
    await flush();
    expect(worn(session, 'me')).toEqual([7]);
    expect(skinPackets()).toEqual([{ payload: [7], to: undefined }]);
  });

  it('reads the skin of everyone in the call from their account, even with nothing sent', async () => {
    account.stored.set('bia', png(3));
    const { session } = startSession();
    session.retain([{ id: 'conn-me', userId: 'me' }, { id: 'conn-bia', userId: 'bia' }, { id: 'conn-caio', userId: 'caio' }]);
    await flush();
    expect(worn(session, 'bia')).toEqual([3]);
    expect(worn(session, 'caio')).toBeNull();
    expect(account.fetchAccountSkin).not.toHaveBeenCalledWith('conn-bia');
  });

  it('keeps a skin when the same account comes back on a new connection (a reload)', async () => {
    account.stored.set('bia', png(3));
    const { session } = startSession();
    session.retain([{ id: 'conn-bia', userId: 'bia' }]);
    await flush();
    session.retain([{ id: 'conn-bia-2', userId: 'bia' }]);
    await flush();
    expect(worn(session, 'bia')).toEqual([3]);
  });

  it('forgets whoever leaves and reads them again when they return', async () => {
    account.stored.set('bia', png(3));
    const { session } = startSession();
    session.retain([{ id: 'conn-bia', userId: 'bia' }]);
    await flush();
    session.retain([]);
    expect(worn(session, 'bia')).toBeNull();
    account.stored.set('bia', png(4));
    session.retain([{ id: 'conn-bia-2', userId: 'bia' }]);
    await flush();
    expect(worn(session, 'bia')).toEqual([4]);
  });

  it('takes a change from its packet, and a read that finishes later does not undo it', async () => {
    let answer: (bytes: Uint8Array | null) => void = () => {};
    account.fetchAccountSkin.mockImplementation((userId: string) => (userId === 'bia' ? new Promise((resolve) => { answer = resolve; }) : Promise.resolve(null)));
    const { session, emit } = startSession();
    session.retain([{ id: 'conn-bia', userId: 'bia' }]);
    emit(RoomEvent.DataReceived, png(9), { identity: 'conn-bia' }, undefined, SKIN_TOPIC);
    await flush();
    answer(png(3));
    await flush();
    expect(worn(session, 'bia')).toEqual([9]);
    emit(RoomEvent.DataReceived, new Uint8Array(0), { identity: 'conn-bia' }, undefined, SKIN_TOPIC);
    await flush();
    expect(worn(session, 'bia')).toBeNull();
  });

  it('saves a new skin to the account before telling the others', async () => {
    const { session, skinPackets } = startSession();
    await flush();
    await session.setLocalSkin(png(5), { pixels: new Uint8ClampedArray([5]), slim: false });
    expect(account.saveAccountSkin).toHaveBeenCalledWith(png(5));
    expect(worn(session, 'me')).toEqual([5]);
    expect(skinPackets().at(-1)).toEqual({ payload: [5], to: undefined });
  });

  it('puts the previous skin back when the server refuses the new one', async () => {
    account.stored.set('me', png(7));
    const { session, skinPackets } = startSession();
    await flush();
    account.saveAccountSkin.mockRejectedValue(new Error('offline'));
    await expect(session.setLocalSkin(null, null)).rejects.toThrow('offline');
    expect(worn(session, 'me')).toEqual([7]);
    expect(skinPackets()).toHaveLength(1);
  });

  it('moves a skin only this browser had to the account, then forgets it', async () => {
    localStorage.setItem(LOCAL_STORAGE_KEYS.legacyPlaygroundSkin, btoa(String.fromCharCode(6)));
    const { session } = startSession();
    await flush();
    await flush();
    expect(account.saveAccountSkin).toHaveBeenCalledWith(png(6));
    expect(worn(session, 'me')).toEqual([6]);
    expect(localStorage.getItem(LOCAL_STORAGE_KEYS.legacyPlaygroundSkin)).toBeNull();
  });

  it('keeps the account skin over the one this browser had', async () => {
    account.stored.set('me', png(7));
    localStorage.setItem(LOCAL_STORAGE_KEYS.legacyPlaygroundSkin, btoa(String.fromCharCode(6)));
    const { session } = startSession();
    await flush();
    expect(account.saveAccountSkin).not.toHaveBeenCalled();
    expect(worn(session, 'me')).toEqual([7]);
    expect(localStorage.getItem(LOCAL_STORAGE_KEYS.legacyPlaygroundSkin)).toBeNull();
  });

  it('sends its skin once the room connects if it was not connected at first', async () => {
    account.stored.set('me', png(7));
    const fake = fakeRoom();
    (fake.room as { state: ConnectionState }).state = ConnectionState.Connecting;
    const session = new PlaygroundSession(fake.room, 'conv', 'conn-me', 'me', { current: new Map() });
    session.start();
    await flush();
    expect(fake.skinPackets()).toEqual([]);
    (fake.room as { state: ConnectionState }).state = ConnectionState.Connected;
    fake.emit(RoomEvent.Connected);
    expect(fake.skinPackets()).toEqual([{ payload: [7], to: undefined }]);
  });
});

describe('PlaygroundSession fighting', () => {
  function sessionWithLink() {
    const fake = fakeRoom();
    const sendWs = vi.fn((_msg: ClientMessage) => true);
    const link = { start: vi.fn(), dispose: vi.fn(), receiveToken: vi.fn(), send: vi.fn((_msg: PlaygroundClientMessage) => true) };
    let options: CombatLinkOptions | null = null;
    const session = new PlaygroundSession(fake.room, 'conv', 'conn-me', 'me', { current: new Map() }, sendWs, (given) => {
      options = given;
      return link;
    });
    const sent = (t: PlaygroundClientMessage['t']) => link.send.mock.calls.map(([msg]) => msg).filter((msg) => msg.t === t);
    return { session, link, sendWs, sent, options: () => options! };
  }

  beforeEach(() => {
    account.fetchAccountSkin.mockReset().mockResolvedValue(null);
  });

  it('reports the position to the service, asking for everyone\'s health the first time', () => {
    const { session, sent } = sessionWithLink();
    session.start();
    expect(sent('playground-pos')).toEqual([{ t: 'playground-pos', x: session.local.x, y: session.local.y, z: session.local.z, yaw: session.local.headYaw, first: true }]);
    // too soon after the last one
    session.setLocal({ ...session.local, x: session.local.x + 1 });
    expect(sent('playground-pos')).toHaveLength(1);
    session.dispose();
  });

  it('asks for everyone\'s health again on every new connection to the service', () => {
    const { session, sent, options } = sessionWithLink();
    session.start();
    options().onConnect();
    expect(sent('playground-pos').map((msg) => 'first' in msg && msg.first)).toEqual([true, true]);
    session.dispose();
  });

  it('asks the app for passes over its socket, and hands the answers to the link', () => {
    const { session, link, sendWs, options } = sessionWithLink();
    session.start();
    expect(link.start).toHaveBeenCalledOnce();
    expect(options().requestToken()).toBe(true);
    expect(sendWs).toHaveBeenCalledWith({ t: 'playground-token', conversationId: 'conv' });
    const reply = { t: 'playground-token' as const, conversationId: 'conv', url: 'https://chat.example.com', token: 'pass' };
    session.receiveToken(reply);
    expect(link.receiveToken).toHaveBeenCalledWith(reply);
    session.dispose();
    expect(link.dispose).toHaveBeenCalledOnce();
  });

  it('sends a punch from where you stand, and none while dead', () => {
    const { session, sent } = sessionWithLink();
    session.attack('conn-bia', true, false);
    expect(sent('playground-attack')).toEqual([{ t: 'playground-attack', targetId: 'conn-bia', x: session.local.x, y: session.local.y, z: session.local.z, yaw: session.local.headYaw, crit: true, sprint: false }]);
    session.receive({ t: 'playground-hit', conversationId: 'conv', attackerId: 'conn-bia', targetId: 'conn-me', damage: 1, health: 0, crit: false, hurt: true });
    session.attack('conn-bia', false, false);
    expect(sent('playground-attack')).toHaveLength(1);
    session.dispose();
  });

  it('only listens to its own call', () => {
    const { session } = sessionWithLink();
    session.receive({ t: 'playground-health', conversationId: 'another', players: [{ id: 'conn-me', health: 3 }] });
    expect(session.combat.getVitals().health).toBe(20);
    session.dispose();
  });
});
