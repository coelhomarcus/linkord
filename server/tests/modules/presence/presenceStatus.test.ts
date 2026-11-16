import { test, describe, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { AppSocket, Participant } from '../../../src/types.js';
import {
  participants, join, removeParticipant, setCallConversationId, handlers as participantHandlers,
  listVisibleOnlineUserIds, visiblePresenceOf, isUserVisiblyOnline,
} from '../../../src/modules/presence/participants.js';
import {
  handlers, loadAccountStatus, setAccountStatusStore, syncPresence, releaseAccountStatusIfUnused, databaseAccountStatusStore,
  loadActivitySettings, setActivitySettingsStore, databaseActivitySettingsStore,
  type AccountStatusStore, type ActivitySettingsStore,
} from '../../../src/modules/presence/presenceStatus.js';
import type { ActivitySettings } from '../../../src/modules/presence/activity.js';
import { getAccountStatus, hasAccountStatus, type AccountStatus } from '../../../src/modules/presence/userStatus.js';

type Sent = { t: string; [key: string]: unknown };

interface FakeSocket extends AppSocket { sent: Sent[] }

function fakeSocket(userId: string): FakeSocket {
  const sent: Sent[] = [];
  return {
    sent,
    participantId: null,
    ip: '127.0.0.1',
    connected: true,
    emit: (_event: string, payload: Sent) => { sent.push(payload); },
    disconnect: () => {},
    user: { tokenHash: 'x', userId, username: userId, displayName: '', avatar: '', avatarColor: 'blurple', banner: '', bio: '', profileLinks: [], role: 'user' },
  } as unknown as FakeSocket;
}

/** An in-memory stand-in for the users table. `failSaves` makes the next saves throw. */
function memoryStore(initial: Record<string, AccountStatus> = {}) {
  const rows = new Map(Object.entries(initial));
  const saves: Array<[string, AccountStatus]> = [];
  const state = { failSaves: false };
  const store: AccountStatusStore = {
    async load(userId) { return rows.get(userId) ?? { status: 'online', customStatus: null }; },
    async save(userId, value) {
      if (state.failSaves) throw new Error('db down');
      saves.push([userId, value]);
      rows.set(userId, value);
    },
  };
  return { store, rows, saves, state };
}

let created: Participant[] = [];

/** What realtime/socket.ts#handleJoin does around join(), minus the database reads. */
async function connect(userId: string, knownPeers: string[] = []): Promise<{ p: Participant; socket: FakeSocket }> {
  await loadAccountStatus(userId);
  const socket = fakeSocket(userId);
  const p = join(socket, {})!.participant;
  p.knownPeerIds = new Set(knownPeers);
  created.push(p);
  syncPresence(userId);
  return { p, socket };
}

function messages(socket: FakeSocket, t: string): Sent[] {
  return socket.sent.filter((m) => m.t === t);
}

async function setPresence(socket: FakeSocket, body: Record<string, unknown>): Promise<void> {
  await handlers['presence-set']!(socket, body);
}

let mem: ReturnType<typeof memoryStore>;

beforeEach(() => {
  mem = memoryStore();
  setAccountStatusStore(mem.store);
});

afterEach(() => {
  const userIds = new Set(created.map((p) => p.userId));
  for (const p of created) {
    if (p.graceTimer) clearTimeout(p.graceTimer);
    participants.delete(p.id);
  }
  for (const userId of userIds) releaseAccountStatusIfUnused(userId);
  created = [];
  setAccountStatusStore(databaseAccountStatusStore);
});

const uid = (name: string) => `${name}-${Math.random()}`;

describe('loading the saved status', () => {
  test('an invisible account is connected but not visibly online', async () => {
    const alice = uid('alice');
    mem.rows.set(alice, { status: 'invisible', customStatus: null });
    await connect(alice);

    assert.equal(isUserVisiblyOnline(alice), false);
    assert.equal(listVisibleOnlineUserIds().includes(alice), false);
    assert.equal(visiblePresenceOf(alice), null);
  });

  test('an expired custom status is dropped on load and cleared in storage', async () => {
    const alice = uid('alice');
    mem.rows.set(alice, { status: 'dnd', customStatus: { emoji: '🎮', text: 'old', expiresAt: new Date(Date.now() - 1000).toISOString() } });
    await connect(alice);

    assert.deepEqual(getAccountStatus(alice), { status: 'dnd', customStatus: null });
    assert.deepEqual(visiblePresenceOf(alice), { status: 'dnd', customStatus: null });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(mem.rows.get(alice), { status: 'dnd', customStatus: null });
  });

  test('the last connection leaving forgets the in-memory status', async () => {
    const alice = uid('alice');
    mem.rows.set(alice, { status: 'invisible', customStatus: null });
    const { p } = await connect(alice);
    assert.equal(hasAccountStatus(alice), true);

    removeParticipant(p);
    assert.equal(hasAccountStatus(alice), false);
  });
});

describe('presence-set', () => {
  test('saves the status, tells peers and the account’s other tabs', async () => {
    const alice = uid('alice');
    const bob = uid('bob');
    const a1 = await connect(alice);
    const a2 = await connect(alice);
    const b = await connect(bob, [alice]);
    const custom = { emoji: '🎮', text: 'jogando Elden Ring', expiresAt: null };

    await setPresence(a1.socket, { requestId: 'r1', status: 'dnd', customStatus: custom });

    assert.deepEqual(mem.saves.at(-1), [alice, { status: 'dnd', customStatus: custom }]);
    assert.deepEqual(messages(b.socket, 'presence-status'), [{ t: 'presence-status', userId: alice, status: 'dnd', customStatus: custom }]);
    assert.deepEqual(messages(a2.socket, 'my-status').at(-1), { t: 'my-status', status: 'dnd', effective: 'dnd', customStatus: custom });
    assert.deepEqual(messages(a1.socket, 'presence-result'), [{ t: 'presence-result', requestId: 'r1', ok: true }]);
  });

  test('changing only the custom status keeps the chosen status', async () => {
    const alice = uid('alice');
    mem.rows.set(alice, { status: 'idle', customStatus: null });
    const a = await connect(alice);

    await setPresence(a.socket, { customStatus: { text: 'brb' } });
    assert.deepEqual(getAccountStatus(alice), { status: 'idle', customStatus: { emoji: '', text: 'brb', expiresAt: null } });

    await setPresence(a.socket, { customStatus: null });
    assert.deepEqual(getAccountStatus(alice), { status: 'idle', customStatus: null });
  });

  test('an unknown status is refused without saving', async () => {
    const alice = uid('alice');
    const a = await connect(alice);

    await setPresence(a.socket, { requestId: 'r', status: 'offline' });
    assert.equal(mem.saves.length, 0);
    assert.deepEqual(messages(a.socket, 'presence-result'), [{ t: 'presence-result', requestId: 'r', ok: false }]);
  });

  test('a failed save changes nothing anyone can see', async () => {
    const alice = uid('alice');
    const bob = uid('bob');
    const a = await connect(alice);
    const b = await connect(bob, [alice]);
    mem.state.failSaves = true;

    await setPresence(a.socket, { requestId: 'r', status: 'dnd' });

    assert.equal(getAccountStatus(alice).status, 'online');
    assert.equal(messages(b.socket, 'presence-status').length, 0);
    assert.deepEqual(messages(a.socket, 'presence-result'), [{ t: 'presence-result', requestId: 'r', ok: false }]);
  });
});

describe('invisible', () => {
  test('turning invisible looks like going offline to peers, not to the account itself', async () => {
    const alice = uid('alice');
    const bob = uid('bob');
    const a = await connect(alice);
    const b = await connect(bob, [alice]);

    await setPresence(a.socket, { status: 'invisible' });

    assert.deepEqual(messages(b.socket, 'participant-left'), [{ t: 'participant-left', id: a.p.id }]);
    assert.equal(messages(b.socket, 'user-offline').length, 1);
    assert.equal(messages(b.socket, 'presence-status').length, 0);
    assert.equal(messages(a.socket, 'user-offline').length, 0);
    assert.equal(listVisibleOnlineUserIds().includes(alice), false);
  });

  test('live updates of a hidden connection stay with its own account', async () => {
    const alice = uid('alice');
    const bob = uid('bob');
    mem.rows.set(alice, { status: 'invisible', customStatus: null });
    const a1 = await connect(alice);
    const a2 = await connect(alice);
    const b = await connect(bob, [alice]);

    await participantHandlers.deafened!(a1.socket, { value: true });

    assert.equal(messages(b.socket, 'participant-updated').length, 0);
    assert.equal(messages(a2.socket, 'participant-updated').length, 1);
  });

  test('an invisible account shows up in the call it joins, and only while in it', async () => {
    const alice = uid('alice');
    const bob = uid('bob');
    mem.rows.set(alice, { status: 'invisible', customStatus: null });
    const a = await connect(alice);
    const b = await connect(bob, [alice]);

    setCallConversationId(a.p, 'voice-1');
    const joined = messages(b.socket, 'participant-joined');
    assert.equal(joined.length, 1);
    assert.equal((joined[0]!.participant as { id: string; callConversationId: string }).callConversationId, 'voice-1');
    assert.equal(listVisibleOnlineUserIds().includes(alice), false);

    setCallConversationId(a.p, null);
    assert.deepEqual(messages(b.socket, 'participant-left'), [{ t: 'participant-left', id: a.p.id }]);
  });

  test('leaving while invisible does not announce going offline', async () => {
    const alice = uid('alice');
    const bob = uid('bob');
    mem.rows.set(alice, { status: 'invisible', customStatus: null });
    const a = await connect(alice);
    const b = await connect(bob, [alice]);

    removeParticipant(a.p);
    assert.equal(messages(b.socket, 'user-offline').length, 0);
    assert.equal(messages(b.socket, 'participant-left').length, 0);
  });

  test('coming back from invisible announces the connection, the status, then online', async () => {
    const alice = uid('alice');
    const bob = uid('bob');
    mem.rows.set(alice, { status: 'invisible', customStatus: null });
    const a = await connect(alice);
    const b = await connect(bob, [alice]);

    await setPresence(a.socket, { status: 'dnd' });

    assert.deepEqual(b.socket.sent.map((m) => m.t), ['participant-joined', 'presence-status', 'user-online']);
    assert.deepEqual(visiblePresenceOf(alice), { status: 'dnd', customStatus: null });
  });
});

describe('automatic idle', () => {
  test('an online account is idle only while every connection is idle', async () => {
    const alice = uid('alice');
    const bob = uid('bob');
    const a1 = await connect(alice);
    const a2 = await connect(alice);
    const b = await connect(bob, [alice]);

    handlers['presence-activity']!(a1.socket, { idle: true });
    assert.equal(visiblePresenceOf(alice)?.status, 'online');
    assert.equal(messages(b.socket, 'presence-status').length, 0);

    handlers['presence-activity']!(a2.socket, { idle: true });
    assert.equal(visiblePresenceOf(alice)?.status, 'idle');
    assert.deepEqual(messages(b.socket, 'presence-status').at(-1), { t: 'presence-status', userId: alice, status: 'idle', customStatus: null });
    assert.equal(messages(a1.socket, 'my-status').at(-1)?.effective, 'idle');
    assert.equal(messages(a1.socket, 'my-status').at(-1)?.status, 'online');

    handlers['presence-activity']!(a1.socket, { idle: false });
    assert.equal(messages(b.socket, 'presence-status').at(-1)?.status, 'online');
  });

  test('do not disturb is not replaced by idle', async () => {
    const alice = uid('alice');
    mem.rows.set(alice, { status: 'dnd', customStatus: null });
    const a = await connect(alice);

    handlers['presence-activity']!(a.socket, { idle: true });
    assert.equal(visiblePresenceOf(alice)?.status, 'dnd');
  });
});

describe('custom status expiry', () => {
  test('the server clears an expired custom status and tells everyone', async () => {
    const alice = uid('alice');
    const bob = uid('bob');
    const a = await connect(alice);
    const b = await connect(bob, [alice]);

    await setPresence(a.socket, { customStatus: { text: 'short', expiresAt: new Date(Date.now() + 40).toISOString() } });
    assert.equal(messages(b.socket, 'presence-status').at(-1)?.customStatus !== null, true);

    await new Promise((resolve) => setTimeout(resolve, 120));

    assert.equal(getAccountStatus(alice).customStatus, null);
    assert.deepEqual(messages(b.socket, 'presence-status').at(-1), { t: 'presence-status', userId: alice, status: 'online', customStatus: null });
    assert.deepEqual(mem.rows.get(alice), { status: 'online', customStatus: null });
  });
});

describe('activity', () => {
  let saved: Map<string, ActivitySettings>;
  let failSaves: boolean;

  beforeEach(() => {
    saved = new Map();
    failSaves = false;
    const store: ActivitySettingsStore = {
      async load(userId) { return saved.get(userId) ?? null; },
      async save(userId, value) {
        if (failSaves) throw new Error('db down');
        saved.set(userId, value);
      },
    };
    setActivitySettingsStore(store);
  });

  afterEach(() => setActivitySettingsStore(databaseActivitySettingsStore));

  const minecraft = { key: 'minecraft', kind: 'playing', name: 'Minecraft', icon: { local: 'a'.repeat(64) }, startedAt: Date.now() - 60_000 };

  async function connectWithSettings(userId: string, knownPeers: string[] = []) {
    await loadActivitySettings(userId);
    return connect(userId, knownPeers);
  }

  async function report(socket: FakeSocket, activity: unknown) {
    await handlers['activity-set']!(socket, { activity });
  }

  test('peers and the account see what the desktop app reports, with a server-built icon', async () => {
    const alice = uid('alice');
    const bob = uid('bob');
    const a = await connectWithSettings(alice);
    const b = await connectWithSettings(bob, [alice]);

    await report(a.socket, minecraft);

    const [status] = messages(b.socket, 'presence-status');
    const activity = (status as unknown as { activity: { key: string; name: string; icon: string; kind: string } }).activity;
    assert.equal(activity.key, 'minecraft');
    assert.equal(activity.name, 'Minecraft');
    assert.equal(activity.kind, 'playing');
    assert.equal(activity.icon, `/api/activity/icons/${'a'.repeat(64)}.webp`);
    assert.equal(visiblePresenceOf(alice)?.activity?.key, 'minecraft');
  });

  test('ending the activity tells peers it ended', async () => {
    const alice = uid('alice');
    const bob = uid('bob');
    const a = await connectWithSettings(alice);
    const b = await connectWithSettings(bob, [alice]);
    await report(a.socket, minecraft);

    await report(a.socket, null);

    assert.deepEqual(messages(b.socket, 'presence-status').at(-1), { t: 'presence-status', userId: alice, status: 'online', customStatus: null, activity: null });
    assert.equal(visiblePresenceOf(alice)?.activity, undefined);
  });

  test('a malformed report counts as no activity, and an unknown icon as none', async () => {
    const alice = uid('alice');
    const a = await connectWithSettings(alice);
    await report(a.socket, { key: 'Bad Key!', kind: 'playing', name: 'x' });
    assert.equal(visiblePresenceOf(alice)?.activity, undefined);
    await report(a.socket, { ...minecraft, icon: { url: 'https://evil.example/x.png' } });
    assert.equal(visiblePresenceOf(alice)?.activity?.icon, null);
    // what older tabs still send: a portrait cover is not an icon, so it shows the glyph instead
    await report(a.socket, { ...minecraft, icon: { igdb: 'co49x5' } });
    assert.equal(visiblePresenceOf(alice)?.activity?.icon, null);
  });

  test('turning sharing off or hiding the key keeps it from peers', async () => {
    const alice = uid('alice');
    const bob = uid('bob');
    const a = await connectWithSettings(alice);
    const b = await connectWithSettings(bob, [alice]);
    await report(a.socket, minecraft);

    await handlers['activity-settings-set']!(a.socket, { requestId: 'r1', hidden: ['minecraft'] });
    assert.deepEqual(saved.get(alice), { sharing: true, hidden: ['minecraft'] });
    assert.equal(visiblePresenceOf(alice)?.activity, undefined);
    assert.deepEqual(messages(b.socket, 'presence-status').at(-1), { t: 'presence-status', userId: alice, status: 'online', customStatus: null, activity: null });
    assert.deepEqual(messages(a.socket, 'my-activity-settings').at(-1), { t: 'my-activity-settings', sharing: true, hidden: ['minecraft'] });
    assert.deepEqual(messages(a.socket, 'activity-settings-result'), [{ t: 'activity-settings-result', requestId: 'r1', ok: true }]);

    await handlers['activity-settings-set']!(a.socket, { hidden: [], sharing: false });
    assert.equal(visiblePresenceOf(alice)?.activity, undefined);
  });

  test('settings saved before are applied from the first moment', async () => {
    const alice = uid('alice');
    saved.set(alice, { sharing: false, hidden: [] });
    const a = await connectWithSettings(alice);
    await report(a.socket, minecraft);
    assert.equal(visiblePresenceOf(alice)?.activity, undefined);
  });

  test('a failed save changes nothing', async () => {
    const alice = uid('alice');
    const a = await connectWithSettings(alice);
    await report(a.socket, minecraft);
    failSaves = true;
    await handlers['activity-settings-set']!(a.socket, { requestId: 'r', sharing: false });
    assert.equal(visiblePresenceOf(alice)?.activity?.key, 'minecraft');
    assert.deepEqual(messages(a.socket, 'activity-settings-result'), [{ t: 'activity-settings-result', requestId: 'r', ok: false }]);
  });

  test('the newest report among the account\'s connections wins, and leaves with its connection', async () => {
    const alice = uid('alice');
    const desktop = await connectWithSettings(alice);
    const laptop = await connectWithSettings(alice);
    await report(desktop.socket, minecraft);
    await report(laptop.socket, { ...minecraft, key: 'steam:570', name: 'Dota 2', icon: null });
    assert.equal(visiblePresenceOf(alice)?.activity?.name, 'Dota 2');

    participants.delete(laptop.p.id);
    created = created.filter((p) => p !== laptop.p);
    releaseAccountStatusIfUnused(alice);
    assert.equal(visiblePresenceOf(alice)?.activity?.name, 'Minecraft');
  });

  test('nobody sees the activity of an invisible account', async () => {
    const alice = uid('alice');
    const a = await connectWithSettings(alice);
    await report(a.socket, minecraft);
    await setPresence(a.socket, { status: 'invisible' });
    assert.equal(visiblePresenceOf(alice), null);
  });
});
