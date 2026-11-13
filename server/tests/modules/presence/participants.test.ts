import { test, describe, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../../../src/config/env.js';
import type { AppSocket, Participant } from '../../../src/types.js';
import {
  participants, join, removeParticipant, handleClose, isUserOnline, setCallConversationId, publicParticipant,
  broadcastToKnownPeers, handlers, restoreCallParticipants, setCallPresenceStore, FLAG_UPDATE_INTERVAL_MS,
  callHeldElsewhere, refuseCallElsewhere, releaseCallsElsewhere, setCallReplacedHook,
  type CallPresenceStore, type RestorableCallParticipant,
} from '../../../src/modules/presence/participants.js';

// These tests only need the participant, so keep the caller's assertions concise.
function joinP(socket: AppSocket, msg: Parameters<typeof join>[1]): Participant | null {
  const result = join(socket, msg);
  return result ? result.participant : null;
}

/** Minimal fake of AppSocket — only the fields participants.ts actually reads
 * (never a real Socket.IO, with no connection at all). */
function fakeSocket(
  userId: string,
  overrides: Partial<{
    username: string;
    displayName: string;
    avatar: string;
    avatarColor: string;
    banner: string;
    bio: string;
    profileLinks: string[];
    role: 'user' | 'admin';
  }> = {},
  ip = '127.0.0.1',
): AppSocket {
  return {
    participantId: null,
    ip,
    connected: true,
    emit: () => {},
    disconnect: () => {},
    user: {
      tokenHash: 'x',
      userId,
      username: overrides.username ?? userId,
      // '' mirrors an account that never set one — session.ts resolves this
      // to the username before it ever reaches join(), but join() also
      // falls back defensively (see sanitizeDisplayName usage there).
      displayName: overrides.displayName ?? '',
      avatar: overrides.avatar ?? '',
      avatarColor: overrides.avatarColor ?? 'blurple',
      banner: overrides.banner ?? '',
      bio: overrides.bio ?? '',
      profileLinks: overrides.profileLinks ?? [],
      role: overrides.role ?? 'user',
    },
  } as unknown as AppSocket;
}

// participants is a module-level Map shared across ALL tests in this
// process — each test tracks the ids it created here and cleans them up in
// afterEach (including canceling any pending graceTimer, which otherwise
// would keep the `node --test` process alive until the reconnect timeout).
let createdIds: string[] = [];
afterEach(() => {
  for (const id of createdIds) {
    const p = participants.get(id);
    if (p?.graceTimer) clearTimeout(p.graceTimer);
    participants.delete(id);
  }
  createdIds = [];
});

describe('join', () => {
  test('creates a new participant and sets socket.participantId', () => {
    const userId = `u-${Math.random()}`;
    const socket = fakeSocket(userId);
    const p = joinP(socket, {});
    assert.ok(p);
    createdIds.push(p!.id);
    assert.equal(socket.participantId, p!.id);
    assert.equal(p!.userId, userId);
    assert.equal(p!.avatarColor, 'blurple');
    assert.equal(p!.deafened, false);
    assert.equal(p!.callConversationId, null);
    assert.equal(participants.get(p!.id), p);
  });

  test('uses the avatar color persisted on the account profile', () => {
    const p = joinP(fakeSocket(`u-${Math.random()}`, { avatarColor: 'fuchsia' }), {})!;
    createdIds.push(p.id);

    assert.equal(p.avatarColor, 'fuchsia');
    assert.equal(publicParticipant(p).avatarColor, 'fuchsia');
  });

  test('an invalid avatar color falls back to the safe default', () => {
    const p = joinP(fakeSocket(`u-${Math.random()}`, { avatarColor: 'url(javascript:alert(1))' }), {})!;
    createdIds.push(p.id);

    assert.equal(p.avatarColor, 'blurple');
  });

  test('accepts a custom hex avatar color (outside the presets)', () => {
    const p = joinP(fakeSocket(`u-${Math.random()}`, { avatarColor: '#A1B2C3' }), {})!;
    createdIds.push(p.id);

    assert.equal(p.avatarColor, '#a1b2c3');
  });

  test('a malformed hex falls back to the safe default (does not leak into CSS)', () => {
    const p = joinP(fakeSocket(`u-${Math.random()}`, { avatarColor: '#zzzzzz' }), {})!;
    createdIds.push(p.id);

    assert.equal(p.avatarColor, 'blurple');
  });

  test('uses the display name persisted on the account', () => {
    const p = joinP(fakeSocket(`u-${Math.random()}`, { displayName: 'Nickname' }), {})!;
    createdIds.push(p.id);

    assert.equal(p.displayName, 'Nickname');
    assert.equal(publicParticipant(p).displayName, 'Nickname');
  });

  test('uses the banner, bio and links persisted on the account', () => {
    const p = joinP(fakeSocket(`u-${Math.random()}`, {
      banner: 'https://example.com/banner.png',
      bio: 'Persisted bio',
      profileLinks: ['https://youtube.com/@fulana'],
    }), {})!;
    createdIds.push(p.id);

    assert.equal(publicParticipant(p).banner, 'https://example.com/banner.png');
    assert.equal(publicParticipant(p).bio, 'Persisted bio');
    assert.deepEqual(publicParticipant(p).profileLinks, ['https://youtube.com/@fulana']);
  });

  test('an empty display name (an account that never picked one) falls back to the username', () => {
    const userId = `u-${Math.random()}`;
    const p = joinP(fakeSocket(userId, { username: 'Fulana', displayName: '' }), {})!;
    createdIds.push(p.id);

    assert.equal(p.displayName, 'Fulana');
  });

  test('an account\'s first connection becomes "online"; a second tab of the SAME account does not duplicate the status', () => {
    const userId = `u-${Math.random()}`;
    assert.equal(isUserOnline(userId), false);

    const p1 = joinP(fakeSocket(userId), {});
    createdIds.push(p1!.id);
    assert.equal(isUserOnline(userId), true);

    // second tab, without a resume token — creates a SECOND participant (a
    // different connection id), but the account is still only ONE "online".
    const p2 = joinP(fakeSocket(userId), {});
    createdIds.push(p2!.id);
    assert.notEqual(p1!.id, p2!.id);
    assert.equal(isUserOnline(userId), true);
  });

});

describe('connection caps', () => {
  const liveNow = () => [...participants.values()].filter((p) => p.socket).length;
  const uniqueIp = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

  function withCaps(caps: { max?: number; perUser?: number; perIp?: number }, fn: () => void): void {
    const original = { max: config.MAX_PARTICIPANTS, perUser: config.MAX_CONNECTIONS_PER_USER, perIp: config.MAX_CONNECTIONS_PER_IP };
    if (caps.max !== undefined) config.MAX_PARTICIPANTS = caps.max;
    if (caps.perUser !== undefined) config.MAX_CONNECTIONS_PER_USER = caps.perUser;
    if (caps.perIp !== undefined) config.MAX_CONNECTIONS_PER_IP = caps.perIp;
    try { fn(); } finally {
      config.MAX_PARTICIPANTS = original.max;
      config.MAX_CONNECTIONS_PER_USER = original.perUser;
      config.MAX_CONNECTIONS_PER_IP = original.perIp;
    }
  }

  function errorCodeOf(socket: AppSocket): () => string | null {
    let code: string | null = null;
    (socket as unknown as { emit: (t: string, m: { code?: string }) => void }).emit = (t, m) => { if (t === 'error') code = m.code ?? null; };
    return () => code;
  }

  test('a full instance (MAX_PARTICIPANTS) rejects a new join', () => {
    withCaps({ max: liveNow() + 1 }, () => {
      const p1 = joinP(fakeSocket(`u-${Math.random()}`, {}, uniqueIp()), {});
      createdIds.push(p1!.id);
      const socket = fakeSocket(`u-${Math.random()}`, {}, uniqueIp());
      const code = errorCodeOf(socket);
      assert.equal(joinP(socket, {}), null);
      assert.equal(code(), 'full');
    });
  });

  test('connections in the reconnect grace window do not count toward the instance cap', () => {
    withCaps({ max: liveNow() + 1 }, () => {
      const s1 = fakeSocket(`u-${Math.random()}`, {}, uniqueIp());
      const p1 = joinP(s1, {});
      createdIds.push(p1!.id);
      handleClose(s1);
      const p2 = joinP(fakeSocket(`u-${Math.random()}`, {}, uniqueIp()), {});
      assert.ok(p2, 'a ghost must not hold the last slot');
      createdIds.push(p2.id);
      assert.ok(participants.has(p1!.id), 'the ghost itself is still waiting for its client');
    });
  });

  test('one account is held to MAX_CONNECTIONS_PER_USER', () => {
    withCaps({ perUser: 2 }, () => {
      const userId = `u-${Math.random()}`;
      for (let i = 0; i < 2; i++) createdIds.push(joinP(fakeSocket(userId, {}, uniqueIp()), {})!.id);
      const socket = fakeSocket(userId, {}, uniqueIp());
      const code = errorCodeOf(socket);
      assert.equal(joinP(socket, {}), null);
      assert.equal(code(), 'too_many_connections');
    });
  });

  test('accounts behind one address are held to MAX_CONNECTIONS_PER_IP together, others still join', () => {
    withCaps({ perIp: 3, perUser: 2 }, () => {
      const ip = uniqueIp();
      createdIds.push(joinP(fakeSocket(`u-${Math.random()}`, {}, ip), {})!.id);
      createdIds.push(joinP(fakeSocket(`u-${Math.random()}`, {}, ip), {})!.id);
      createdIds.push(joinP(fakeSocket(`u-${Math.random()}`, {}, ip), {})!.id);
      const socket = fakeSocket(`u-${Math.random()}`, {}, ip);
      const code = errorCodeOf(socket);
      assert.equal(joinP(socket, {}), null);
      assert.equal(code(), 'too_many_connections');
      const elsewhere = joinP(fakeSocket(`u-${Math.random()}`, {}, uniqueIp()), {});
      assert.ok(elsewhere);
      createdIds.push(elsewhere.id);
    });
  });

  test('a resume is never refused by the caps: it already held its slot', () => {
    withCaps({ max: liveNow() + 1 }, () => {
      const userId = `u-${Math.random()}`;
      const s1 = fakeSocket(userId, {}, uniqueIp());
      const p1 = joinP(s1, {});
      createdIds.push(p1!.id);
      handleClose(s1);
      const other = joinP(fakeSocket(`u-${Math.random()}`, {}, uniqueIp()), {});
      createdIds.push(other!.id);
      const resumed = joinP(fakeSocket(userId, {}, uniqueIp()), { id: p1!.id, token: p1!.token });
      assert.equal(resumed?.id, p1!.id);
    });
  });
});

describe('reconnection (handleClose + resume by id/token)', () => {
  test('resumes the SAME identity with a valid id/token, clearing the graceTimer', () => {
    const userId = `u-${Math.random()}`;
    const socket1 = fakeSocket(userId);
    const original = joinP(socket1, {});
    createdIds.push(original!.id);

    handleClose(socket1); // "tab closed" — enters the grace window
    assert.equal(original!.socket, null);
    assert.ok(original!.graceTimer);

    const socket2 = fakeSocket(userId);
    const resumed = joinP(socket2, { id: original!.id, token: original!.token });

    assert.equal(resumed!.id, original!.id); // same identity, not a new participant
    assert.equal(resumed!.socket, socket2);
    assert.equal(resumed!.graceTimer, null);
  });

  test('a wrong token does not resume the old identity (but evicting the ghost frees up a new join)', () => {
    const userId = `u-${Math.random()}`;
    const socket1 = fakeSocket(userId);
    const original = joinP(socket1, {});
    createdIds.push(original!.id);

    handleClose(socket1);

    const socket2 = fakeSocket(userId);
    const fresh = joinP(socket2, { id: original!.id, token: 'wrong-token' });
    createdIds.push(fresh!.id);

    assert.notEqual(fresh!.id, original!.id); // did NOT reuse the old identity
    // the ghost from the old connection (socket null) got removed in the
    // process — only the new identity is left for this account.
    assert.equal(participants.has(original!.id), false);
  });
});

describe('removeParticipant', () => {
  test('removes it from the Map and marks the account offline if it was its only connection', () => {
    const userId = `u-${Math.random()}`;
    const p = joinP(fakeSocket(userId), {})!;
    assert.equal(isUserOnline(userId), true);

    removeParticipant(p);
    assert.equal(participants.has(p.id), false);
    assert.equal(isUserOnline(userId), false);
  });

  test('calling it again (already removed) is a safe no-op', () => {
    const p = joinP(fakeSocket(`u-${Math.random()}`), {})!;
    removeParticipant(p);
    assert.doesNotThrow(() => removeParticipant(p));
  });
});

describe('reconnect grace length', () => {
  afterEach(() => mock.timers.reset());

  test('a connection outside a call is removed after RECONNECT_GRACE_MS', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const socket = fakeSocket(`u-${Math.random()}`);
    const p = joinP(socket, {})!;
    createdIds.push(p.id);

    handleClose(socket);
    mock.timers.tick(config.RECONNECT_GRACE_MS);
    assert.equal(participants.has(p.id), false);
  });

  test('a connection in a call is held for CALL_RECONNECT_GRACE_MS', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const socket = fakeSocket(`u-${Math.random()}`);
    const p = joinP(socket, {})!;
    createdIds.push(p.id);
    setCallConversationId(p, 'conv-1');

    handleClose(socket);
    mock.timers.tick(config.RECONNECT_GRACE_MS);
    assert.equal(participants.get(p.id), p);
    mock.timers.tick(config.CALL_RECONNECT_GRACE_MS - config.RECONNECT_GRACE_MS);
    assert.equal(participants.has(p.id), false);
  });
});

describe('setCallConversationId', () => {
  test('changes the field and reflects it in publicParticipant (without leaking the token)', () => {
    const p = joinP(fakeSocket(`u-${Math.random()}`), {})!;
    createdIds.push(p.id);

    setCallConversationId(p, 'grupo-1');
    assert.equal(p.callConversationId, 'grupo-1');
    assert.equal(publicParticipant(p).callConversationId, 'grupo-1');
    assert.equal('token' in publicParticipant(p), false);

    setCallConversationId(p, null);
    assert.equal(p.callConversationId, null);
  });

  test('resets the self-reported media flags on every join/leave — no ghost left from a previous call', () => {
    const p = joinP(fakeSocket(`u-${Math.random()}`), {})!;
    createdIds.push(p.id);

    setCallConversationId(p, 'grupo-1');
    p.micActivated = true;
    p.micMuted = false;
    p.cameraOn = true;
    p.sharing = true;
    p.speaking = true;

    setCallConversationId(p, 'grupo-2');
    assert.equal(p.micActivated, false);
    assert.equal(p.micMuted, true);
    assert.equal(p.cameraOn, false);
    assert.equal(p.sharing, false);
    assert.equal(p.speaking, false);
  });
});

describe('one call per account', () => {
  function recordingSocket(userId: string): AppSocket & { sent: { t: string; [key: string]: unknown }[] } {
    const sent: { t: string; [key: string]: unknown }[] = [];
    return Object.assign(fakeSocket(userId), { sent, emit: (_event: string, payload: { t: string }) => { sent.push(payload); } });
  }

  function connect(userId: string, v?: number) {
    const socket = recordingSocket(userId);
    const p = joinP(socket, v === undefined ? {} : { v })!;
    createdIds.push(p.id);
    return { p, socket };
  }

  afterEach(() => setCallReplacedHook(null));

  test('entering a call takes the account\'s other connection out of its own, and tells that tab why', () => {
    const userId = `u-${Math.random()}`;
    const phone = connect(userId);
    const desktop = connect(userId);
    setCallConversationId(phone.p, 'voice-1');
    phone.socket.sent.length = 0;

    setCallConversationId(desktop.p, 'voice-2');

    assert.equal(phone.p.callConversationId, null);
    assert.equal(desktop.p.callConversationId, 'voice-2');
    assert.deepEqual(phone.socket.sent.find((m) => m.t === 'call-replaced'), { t: 'call-replaced', conversationId: 'voice-1' });
  });

  test('moving within the same call still leaves a single connection in it', () => {
    const userId = `u-${Math.random()}`;
    const phone = connect(userId);
    const desktop = connect(userId);
    setCallConversationId(phone.p, 'voice-1');

    setCallConversationId(desktop.p, 'voice-1');

    const inCall = [...participants.values()].filter((p) => p.userId === userId && p.callConversationId);
    assert.deepEqual(inCall.map((p) => p.id), [desktop.p.id]);
  });

  test('the other tab leaves before the new one shows up, so nobody sees the account in two calls', () => {
    const userId = `u-${Math.random()}`;
    const phone = connect(userId);
    const desktop = connect(userId);
    setCallConversationId(phone.p, 'voice-1');
    const watcher = connect(userId);
    watcher.socket.sent.length = 0;

    setCallConversationId(desktop.p, 'voice-2');

    const updates = watcher.socket.sent
      .filter((m) => m.t === 'participant-updated')
      .map((m) => (m.participant as { id: string; callConversationId: string | null }));
    assert.deepEqual(updates.map((u) => [u.id, u.callConversationId]), [[phone.p.id, null], [desktop.p.id, 'voice-2']]);
  });

  test('other accounts keep their calls', () => {
    const mine = connect(`u-${Math.random()}`);
    const theirs = connect(`u-${Math.random()}`);
    setCallConversationId(theirs.p, 'voice-1');

    setCallConversationId(mine.p, 'voice-1');

    assert.equal(theirs.p.callConversationId, 'voice-1');
  });

  test('a connection waiting out its reconnect grace still holds the call', () => {
    const userId = `u-${Math.random()}`;
    const phone = connect(userId);
    const desktop = connect(userId);
    setCallConversationId(phone.p, 'voice-1');
    handleClose(phone.socket);

    assert.equal(callHeldElsewhere(desktop.p), phone.p);
    assert.equal(callHeldElsewhere(phone.p), null);
  });

  test('the hook hears which call was left and which one replaced it', () => {
    const userId = `u-${Math.random()}`;
    const phone = connect(userId);
    const desktop = connect(userId);
    setCallConversationId(phone.p, 'dm-1');
    const heard: unknown[] = [];
    setCallReplacedHook((evicted, conversationId, next) => heard.push([evicted.id, conversationId, next]));

    releaseCallsElsewhere(desktop.p, null);

    assert.deepEqual(heard, [[phone.p.id, 'dm-1', null]]);
    assert.equal(phone.p.callConversationId, null);
  });

  test('a protocol 20 tab is refused with call-elsewhere, an older one with the code it already handles', () => {
    const userId = `u-${Math.random()}`;
    const current = connect(userId, 20);
    const old = connect(userId, 19);

    refuseCallElsewhere(current.p);
    refuseCallElsewhere(old.p);

    assert.equal(current.socket.sent.find((m) => m.t === 'error')?.code, 'call-elsewhere');
    assert.equal(old.socket.sent.find((m) => m.t === 'error')?.code, 'call-not-allowed');
  });
});

describe('self-reported media state (mic-state / camera / screen-share / speaking)', () => {
  test('mic-state changes micActivated/micMuted and reflects it in publicParticipant', () => {
    const socket = fakeSocket(`u-${Math.random()}`);
    const p = joinP(socket, {})!;
    createdIds.push(p.id);
    setCallConversationId(p, 'voice-1');

    handlers['mic-state'](socket, { activated: true, muted: false });
    assert.equal(p.micActivated, true);
    assert.equal(p.micMuted, false);
    assert.equal(publicParticipant(p).micActivated, true);
    assert.equal(publicParticipant(p).micMuted, false);
  });

  test('a protocol 18 client joins a call with its mic starting until it reports it settled', () => {
    const socket = fakeSocket(`u-${Math.random()}`);
    const p = joinP(socket, { v: 18 })!;
    createdIds.push(p.id);
    setCallConversationId(p, 'voice-1');
    assert.equal(publicParticipant(p).micStarting, true);
    assert.equal(publicParticipant(p).micMuted, false);

    handlers['mic-state'](socket, { activated: false, muted: true, starting: true });
    assert.equal(p.micStarting, true);
    assert.equal(p.micMuted, true);

    handlers['mic-state'](socket, { activated: false, muted: true });
    assert.equal(p.micStarting, false);

    setCallConversationId(p, null);
    assert.equal(p.micStarting, false);
    assert.equal(p.micMuted, true);
  });

  test('an older client never starts in that state, since it would never clear it', () => {
    const socket = fakeSocket(`u-${Math.random()}`);
    const p = joinP(socket, { v: 17 })!;
    createdIds.push(p.id);
    setCallConversationId(p, 'voice-1');
    assert.equal(p.micStarting, false);
    assert.equal(p.micMuted, true);
  });

  test('camera and screen-share change cameraOn/sharing', () => {
    const socket = fakeSocket(`u-${Math.random()}`);
    const p = joinP(socket, {})!;
    createdIds.push(p.id);
    setCallConversationId(p, 'voice-1');

    handlers.camera(socket, { on: true });
    assert.equal(p.cameraOn, true);

    handlers['screen-share'](socket, { on: true });
    assert.equal(p.sharing, true);
  });

  test('a camera report outside a call does not turn the icon back on', () => {
    const socket = fakeSocket(`u-${Math.random()}`);
    const p = joinP(socket, {})!;
    createdIds.push(p.id);
    setCallConversationId(p, 'voice-1');
    handlers.camera(socket, { on: true });
    setCallConversationId(p, null);

    handlers.camera(socket, { on: true });
    handlers['mic-state'](socket, { activated: true, muted: false });
    handlers['screen-share'](socket, { on: true });
    handlers.speaking(socket, { value: true });

    assert.equal(p.cameraOn, false);
    assert.equal(p.micActivated, false);
    assert.equal(p.sharing, false);
    assert.equal(p.speaking, false);
  });

  test('speaking changes the speaking field', () => {
    const socket = fakeSocket(`u-${Math.random()}`);
    const p = joinP(socket, {})!;
    createdIds.push(p.id);
    setCallConversationId(p, 'voice-1');

    handlers.speaking(socket, { value: true });
    assert.equal(p.speaking, true);
  });

  test('a message from a socket that does not own the participant is ignored', () => {
    const socket = fakeSocket(`u-${Math.random()}`);
    const p = joinP(socket, {})!;
    createdIds.push(p.id);
    setCallConversationId(p, 'voice-1');

    const otherSocket = fakeSocket(`u-${Math.random()}`);
    handlers.camera(otherSocket, { on: true });
    assert.equal(p.cameraOn, false);
  });
});

describe('media flag broadcasts', () => {
  function watchedCaller() {
    const socket = fakeSocket(`u-${Math.random()}`);
    const p = joinP(socket, {})!;
    createdIds.push(p.id);
    setCallConversationId(p, 'voice-1');
    const updates: Array<Record<string, unknown>> = [];
    const watcher = fakeSocket(`u-${Math.random()}`);
    (watcher as unknown as { emit: (t: string, obj: { t: string; participant?: Record<string, unknown> }) => void }).emit = (_t, obj) => {
      if (obj.t === 'participant-updated' && obj.participant) updates.push(obj.participant);
    };
    const peer = joinP(watcher, {})!;
    createdIds.push(peer.id);
    peer.knownPeerIds.add(p.userId);
    return { socket, p, updates };
  }

  test('a burst goes out once at once and once more with the state it ended in', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
    const { socket, updates } = watchedCaller();

    for (let i = 0; i < 50; i += 1) handlers.speaking(socket, { value: i % 2 === 0 });
    handlers.camera(socket, { on: true });
    assert.equal(updates.length, 1);
    assert.equal(updates[0]!.speaking, true);

    t.mock.timers.tick(FLAG_UPDATE_INTERVAL_MS);
    assert.equal(updates.length, 2);
    assert.equal(updates[1]!.speaking, false);
    assert.equal(updates[1]!.cameraOn, true);
  });

  test('a report that changes nothing is not broadcast', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
    const { socket, updates } = watchedCaller();

    handlers.speaking(socket, { value: false });
    handlers.camera(socket, { on: false });
    handlers['screen-share'](socket, { on: false });
    t.mock.timers.tick(FLAG_UPDATE_INTERVAL_MS);
    assert.equal(updates.length, 0);
  });

  test('a connection gone before the trailing update sends nothing', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
    const { socket, p, updates } = watchedCaller();
    handlers.speaking(socket, { value: true });
    handlers.speaking(socket, { value: false });
    participants.delete(p.id);
    t.mock.timers.tick(FLAG_UPDATE_INTERVAL_MS);
    assert.equal(updates.length, 1);
  });
});

describe('broadcastToKnownPeers (presence scoping)', () => {
  function fakeSocketWithSpy(userId: string): { socket: AppSocket; emitted: string[]; payloads: Array<{ t: string; [key: string]: unknown }> } {
    const emitted: string[] = [];
    const payloads: Array<{ t: string; [key: string]: unknown }> = [];
    const socket = fakeSocket(userId);
    (socket as unknown as { emit: (t: string, obj: { t: string; [key: string]: unknown }) => void }).emit = (t, obj) => {
      emitted.push(t);
      payloads.push(obj);
    };
    return { socket, emitted, payloads };
  }

  test('delivers only to those who have the subject in their own knownPeerIds', () => {
    const subjectId = `u-${Math.random()}`;
    const strangerId = `u-${Math.random()}`;

    const subjectConn = fakeSocketWithSpy(subjectId);
    const subject = joinP(subjectConn.socket, {})!;
    createdIds.push(subject.id);

    const knowerConn = fakeSocketWithSpy(`u-${Math.random()}`);
    const knower = joinP(knowerConn.socket, {})!;
    createdIds.push(knower.id);
    knower.knownPeerIds.add(subjectId);

    const strangerConn = fakeSocketWithSpy(strangerId);
    const stranger = joinP(strangerConn.socket, {})!;
    createdIds.push(stranger.id);
    // the stranger's knownPeerIds stays empty — does not know the subject.

    knowerConn.emitted.length = 0;
    strangerConn.emitted.length = 0;
    broadcastToKnownPeers(subjectId, { t: 'participant-updated' });

    assert.ok(knowerConn.emitted.includes('participant-updated'));
    assert.equal(strangerConn.emitted.includes('participant-updated'), false);
  });

  test('a blocked pair (in either direction) does not receive presence, even while sharing a conversation', () => {
    const subjectId = `u-${Math.random()}`;
    const subjectConn = fakeSocketWithSpy(subjectId);
    createdIds.push(joinP(subjectConn.socket, {})!.id);

    const friendConn = fakeSocketWithSpy(`u-${Math.random()}`);
    const friend = joinP(friendConn.socket, {})!;
    createdIds.push(friend.id);
    friend.knownPeerIds.add(subjectId);

    const blockedConn = fakeSocketWithSpy(`u-${Math.random()}`);
    const blocked = joinP(blockedConn.socket, {})!;
    createdIds.push(blocked.id);
    blocked.knownPeerIds.add(subjectId);   // shares a conversation with the subject...
    blocked.blockedPeerIds.add(subjectId); // ...but there is a block between them

    friendConn.emitted.length = 0;
    blockedConn.emitted.length = 0;
    broadcastToKnownPeers(subjectId, { t: 'participant-updated' });

    assert.ok(friendConn.emitted.includes('participant-updated'));
    assert.equal(blockedConn.emitted.includes('participant-updated'), false);
  });

  test('user-offline includes lastSeenAt when the last connection leaves', () => {
    const subjectId = `u-${Math.random()}`;
    const knowerConn = fakeSocketWithSpy(`u-${Math.random()}`);
    const knower = joinP(knowerConn.socket, {})!;
    createdIds.push(knower.id);
    knower.knownPeerIds.add(subjectId);

    const subject = joinP(fakeSocket(subjectId), {})!;
    knowerConn.emitted.length = 0;
    knowerConn.payloads.length = 0;
    removeParticipant(subject);

    const offline = knowerConn.payloads.find((p) => p.t === 'user-offline');
    assert.ok(offline);
    assert.equal(offline.userId, subjectId);
    assert.equal(typeof offline.lastSeenAt, 'string');
    assert.match(String(offline.lastSeenAt), /^\d{4}-\d{2}-\d{2}T/);
  });

  test('always delivers to other tabs of the SAME account, even without knownPeerIds', () => {
    const userId = `u-${Math.random()}`;

    const tab1 = fakeSocketWithSpy(userId);
    const p1 = joinP(tab1.socket, {})!;
    createdIds.push(p1.id);

    // a genuine second tab (no resume — fresh id/token, a distinct
    // participant): nobody has their own userId in knownPeerIds (you're not
    // your own friend/conversation-member), but multi-tab delivery ignores that.
    const tab2 = fakeSocketWithSpy(userId);
    const p2 = joinP(tab2.socket, {})!;
    createdIds.push(p2.id);
    assert.notEqual(p2.id, p1.id);

    tab2.emitted.length = 0;
    broadcastToKnownPeers(userId, { t: 'participant-updated' });
    assert.ok(tab2.emitted.includes('participant-updated'));
  });
});

function restorable(overrides: Partial<RestorableCallParticipant> & { userId?: string } = {}): RestorableCallParticipant {
  const userId = overrides.userId ?? `u-${Math.random()}`;
  return {
    id: overrides.id ?? `restored-${Math.random()}`,
    token: overrides.token ?? 'saved-token',
    conversationId: overrides.conversationId ?? 'voice-1',
    deafened: overrides.deafened ?? false,
    profile: {
      userId, username: userId, displayName: 'Restored', avatar: '', avatarPoster: '', avatarColor: 'blurple',
      banner: '', bannerPoster: '', bio: '', profileLinks: [], role: 'user',
    },
  };
}

describe('restoreCallParticipants (a restart looks like a dropped connection)', () => {
  test('rebuilds the participant in the grace window with the saved identity and call', () => {
    const entry = restorable({ deafened: true });
    createdIds.push(entry.id);

    assert.equal(restoreCallParticipants([entry], 60_000), 1);
    const ghost = participants.get(entry.id)!;
    assert.equal(ghost.socket, null);
    assert.equal(ghost.callConversationId, 'voice-1');
    assert.equal(ghost.deafened, true);
    assert.equal(ghost.displayName, 'Restored');
    assert.ok(ghost.graceTimer);
    assert.equal(isUserOnline(ghost.userId), false);
  });

  test('the client resumes it with the saved id and token, keeping the call', () => {
    const entry = restorable();
    createdIds.push(entry.id);
    restoreCallParticipants([entry], 60_000);

    const socket = fakeSocket(entry.profile.userId);
    const resumed = joinP(socket, { id: entry.id, token: entry.token })!;

    assert.equal(resumed.id, entry.id);
    assert.equal(resumed.socket, socket);
    assert.equal(resumed.graceTimer, null);
    assert.equal(resumed.callConversationId, 'voice-1');
  });

  test('another account cannot resume it, and a wrong token does not either', () => {
    const entry = restorable();
    createdIds.push(entry.id);
    restoreCallParticipants([entry], 60_000);

    const stranger = joinP(fakeSocket(`u-${Math.random()}`), { id: entry.id, token: entry.token })!;
    createdIds.push(stranger.id);
    assert.notEqual(stranger.id, entry.id);

    const wrongToken = joinP(fakeSocket(entry.profile.userId), { id: entry.id, token: 'nope' })!;
    createdIds.push(wrongToken.id);
    assert.notEqual(wrongToken.id, entry.id);
  });

  test('a fresh join of the same account does not evict the ghost still waiting for its client', () => {
    const entry = restorable();
    createdIds.push(entry.id);
    restoreCallParticipants([entry], 60_000);

    const otherTab = joinP(fakeSocket(entry.profile.userId), {})!;
    createdIds.push(otherTab.id);

    assert.ok(participants.has(entry.id));
  });

  test('is removed once the grace runs out without a resume', async () => {
    const entry = restorable();
    createdIds.push(entry.id);
    restoreCallParticipants([entry], 10);

    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(participants.has(entry.id), false);
  });

  test('does not replace a participant that is already there', () => {
    const entry = restorable();
    createdIds.push(entry.id);
    restoreCallParticipants([entry], 60_000);
    assert.equal(restoreCallParticipants([entry], 60_000), 0);
  });
});

describe('call membership persistence', () => {
  function recordingStore() {
    const events: string[] = [];
    const store: CallPresenceStore = {
      save: async (p) => { events.push(`save:${p.id}:${p.callConversationId}:${p.deafened}`); },
      remove: async (id) => { events.push(`remove:${id}`); },
    };
    return { events, store };
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

  test('each change is written as the state it ends up in, and a real removal forgets the connection last', async () => {
    const { events, store } = recordingStore();
    setCallPresenceStore(store);
    try {
      const p = joinP(fakeSocket(`u-${Math.random()}`), {})!;
      createdIds.push(p.id);
      setCallConversationId(p, 'voice-1');
      await settle();
      assert.deepEqual(events, [`save:${p.id}:voice-1:false`]);

      handlers.deafened!(p.socket!, { value: true });
      await settle();
      assert.equal(events.at(-1), `save:${p.id}:voice-1:true`);

      setCallConversationId(p, null);
      removeParticipant(p);
      await settle();
      assert.equal(events.at(-2), `save:${p.id}:null:true`);
      assert.equal(events.at(-1), `remove:${p.id}`);
    } finally {
      setCallPresenceStore(null);
    }
  });

  test('toggling deafen in a burst writes once at once and once with the final state', async (t) => {
    const { events, store } = recordingStore();
    setCallPresenceStore(store);
    try {
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
      const p = joinP(fakeSocket(`u-${Math.random()}`), {})!;
      createdIds.push(p.id);
      setCallConversationId(p, 'voice-1');
      for (let i = 0; i < 40; i += 1) handlers.deafened!(p.socket!, { value: i % 2 === 0 });
      handlers.deafened!(p.socket!, { value: true });
      t.mock.timers.tick(FLAG_UPDATE_INTERVAL_MS);
      t.mock.timers.reset();
      await settle();
      // the call join, the first toggle and one trailing write; each save reads the live participant
      assert.equal(events.length, 3);
      assert.equal(events.at(-1), `save:${p.id}:voice-1:true`);
    } finally {
      setCallPresenceStore(null);
    }
  });

  test('deafening outside a call is not written', async () => {
    const { events, store } = recordingStore();
    setCallPresenceStore(store);
    try {
      const p = joinP(fakeSocket(`u-${Math.random()}`), {})!;
      createdIds.push(p.id);
      handlers.deafened!(p.socket!, { value: true });
      await settle();
      assert.deepEqual(events, []);
    } finally {
      setCallPresenceStore(null);
    }
  });

  test('a failing store never breaks the call path', async () => {
    setCallPresenceStore({ save: async () => { throw new Error('db down'); }, remove: async () => { throw new Error('db down'); } });
    try {
      const p = joinP(fakeSocket(`u-${Math.random()}`), {})!;
      createdIds.push(p.id);
      assert.doesNotThrow(() => setCallConversationId(p, 'voice-1'));
      await settle();
      assert.equal(p.callConversationId, 'voice-1');
    } finally {
      setCallPresenceStore(null);
    }
  });
});
