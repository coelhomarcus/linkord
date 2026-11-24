import { test, describe, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { AppSocket, Participant } from '../../../src/types.js';
import { participants, join } from '../../../src/modules/presence/participants.js';
import {
  attackDamage, createFighter, handlers, healthOf, HURT_IMMUNITY_MS, knockbackFor, landHit, MAX_ATTACK_DISTANCE, MAX_HEALTH,
  readPosition, REGEN_INTERVAL_MS, setPlaygroundCheck, withinReach,
} from '../../../src/modules/playground/combat.js';

describe('health', () => {
  test('a bare hand takes half a heart, a critical one and a half times that', () => {
    assert.equal(attackDamage(false), 1);
    assert.equal(attackDamage(true), 1.5);
  });

  test('comes back one point every 4 s, up to full, and never for the dead', () => {
    const fighter = createFighter('c', 0);
    landHit(fighter, 5, 0);
    assert.equal(healthOf(fighter, 0), MAX_HEALTH - 5);
    assert.equal(healthOf(fighter, REGEN_INTERVAL_MS - 1), MAX_HEALTH - 5);
    assert.equal(healthOf(fighter, REGEN_INTERVAL_MS * 2), MAX_HEALTH - 3);
    assert.equal(healthOf(fighter, REGEN_INTERVAL_MS * 100), MAX_HEALTH);
    const dead = createFighter('c', 0);
    landHit(dead, MAX_HEALTH, 0);
    assert.equal(healthOf(dead, REGEN_INTERVAL_MS * 10), 0);
  });
});

describe('landHit', () => {
  test('a fresh hit hurts; another inside the immunity is swallowed unless stronger', () => {
    const target = createFighter('c', 0);
    assert.deepEqual(landHit(target, 1, 1000), { dealt: 1, hurt: true, health: 19 });
    assert.equal(landHit(target, 1, 1000 + HURT_IMMUNITY_MS - 1), null);
    // a critical right after: only what it adds, and no knockback
    assert.deepEqual(landHit(target, 1.5, 1100), { dealt: 0.5, hurt: false, health: 18.5 });
    assert.equal(landHit(target, 1.5, 1200), null);
    assert.deepEqual(landHit(target, 1, 1000 + HURT_IMMUNITY_MS), { dealt: 1, hurt: true, health: 17.5 });
  });

  test('nothing lands on the dead', () => {
    const target = createFighter('c', 0);
    assert.deepEqual(landHit(target, 30, 0), { dealt: 30, hurt: true, health: 0 });
    assert.equal(landHit(target, 1, HURT_IMMUNITY_MS * 4), null);
  });
});

describe('knockbackFor', () => {
  test('pushes 0.4 away from the attacker', () => {
    const attacker = { ...createFighter('c', 0), x: 0, z: 0 };
    const target = { ...createFighter('c', 0), x: 3, z: 0 };
    assert.deepEqual(knockbackFor(attacker, target, false), { push: [0.4, 0], extra: null });
  });

  test('a sprinting attacker adds 0.5 along its look and 0.1 up', () => {
    const attacker = { ...createFighter('c', 0), x: 0, z: 0, yaw: 0 };
    const target = { ...createFighter('c', 0), x: 0, z: 2 };
    assert.deepEqual(knockbackFor(attacker, target, true), { push: [0, 0.4], extra: [0, 0.1, 0.5] });
  });

  test('two players in the same spot get a random direction, still 0.4 long', () => {
    const fighter = createFighter('c', 0);
    const { push } = knockbackFor(fighter, { ...fighter }, false, () => 0.3);
    assert.ok(Math.abs(Math.hypot(push[0], push[1]) - 0.4) < 0.002);
  });
});

describe('reach and positions', () => {
  test('up to 6 blocks apart', () => {
    const attacker = createFighter('c', 0);
    assert.equal(withinReach(attacker, { ...attacker, x: MAX_ATTACK_DISTANCE }), true);
    assert.equal(withinReach(attacker, { ...attacker, x: 4, y: 4.5 }), false);
  });

  test('a report needs three finite coordinates on the island', () => {
    assert.deepEqual(readPosition({ x: 1, y: 2, z: 3, yaw: 0.5 }), { x: 1, y: 2, z: 3, yaw: 0.5 });
    assert.deepEqual(readPosition({ x: 1, y: 2, z: 3 }), { x: 1, y: 2, z: 3, yaw: 0 });
    assert.equal(readPosition({ x: 1, y: Number.NaN, z: 3 }), null);
    assert.equal(readPosition({ x: '1', y: 2, z: 3 }), null);
    assert.equal(readPosition({ x: 1e9, y: 2, z: 3 }), null);
  });
});

describe('handlers', () => {
  const sent = new Map<string, { t: string; [key: string]: unknown }[]>();
  let created: Participant[] = [];

  function connect(userId: string, conversationId: string | null): { socket: AppSocket; p: Participant } {
    const socket = {
      participantId: null, ip: '127.0.0.1', connected: true, disconnect: () => {},
      emit: (t: string, msg: { t: string }) => { sent.get(userId)!.push({ ...msg, t }); },
      user: { tokenHash: 'x', userId, username: userId, displayName: '', avatar: '', avatarColor: 'blurple', banner: '', bio: '', profileLinks: [], role: 'user' },
    } as unknown as AppSocket;
    sent.set(userId, []);
    const p = join(socket, {})!.participant;
    p.callConversationId = conversationId;
    created.push(p);
    return { socket, p };
  }

  const messages = (userId: string, t: string) => sent.get(userId)!.filter((m) => m.t === t);
  const report = (socket: AppSocket, x: number, extra: Record<string, unknown> = {}) => handlers['playground-pos']!(socket, { x, y: 10, z: 0, yaw: 0, ...extra });
  const attack = (socket: AppSocket, targetId: string, x: number, extra: Record<string, unknown> = {}) =>
    handlers['playground-attack']!(socket, { targetId, x, y: 10, z: 0, yaw: Math.PI / 2, crit: false, sprint: false, ...extra });

  beforeEach(() => {
    setPlaygroundCheck(async (conversationId) => conversationId.startsWith('playground'));
  });

  afterEach(() => {
    for (const p of created) {
      if (p.graceTimer) clearTimeout(p.graceTimer);
      participants.delete(p.id);
    }
    created = [];
    sent.clear();
  });

  test('a hit in reach reaches everyone in the call, with the knockback', async () => {
    const a = connect(`a-${Math.random()}`, 'playground-1');
    const b = connect(`b-${Math.random()}`, 'playground-1');
    await report(b.socket, 2);
    await attack(a.socket, b.p.id, 0, { sprint: true });
    for (const who of [a.p.userId, b.p.userId]) {
      const [hit] = messages(who, 'playground-hit');
      assert.deepEqual(hit, {
        t: 'playground-hit', conversationId: 'playground-1', attackerId: a.p.id, targetId: b.p.id,
        damage: 1, health: 19, crit: false, hurt: true, push: [0.4, 0], extra: [0.5, 0.1, 0],
      });
    }
  });

  test('no hit from too far, on someone who never reported, in another call or outside a playground', async () => {
    const a = connect(`a-${Math.random()}`, 'playground-1');
    const far = connect(`far-${Math.random()}`, 'playground-1');
    const silent = connect(`silent-${Math.random()}`, 'playground-1');
    const elsewhere = connect(`else-${Math.random()}`, 'playground-2');
    await report(far.socket, 20);
    await report(elsewhere.socket, 1);
    await attack(a.socket, far.p.id, 0);
    await attack(a.socket, silent.p.id, 0);
    await attack(a.socket, elsewhere.p.id, 0);
    const c = connect(`c-${Math.random()}`, 'voice-1');
    const d = connect(`d-${Math.random()}`, 'voice-1');
    await report(d.socket, 1);
    await attack(c.socket, d.p.id, 0);
    for (const userId of sent.keys()) assert.deepEqual(messages(userId, 'playground-hit'), []);
  });

  test('a death stops the fighting until the respawn, which heals', async () => {
    const a = connect(`a-${Math.random()}`, 'playground-1');
    const b = connect(`b-${Math.random()}`, 'playground-1');
    await report(b.socket, 1);
    const realNow = Date.now;
    let now = realNow();
    Date.now = () => now;
    try {
      for (let i = 0; i < MAX_HEALTH; i++) {
        await attack(a.socket, b.p.id, 0);
        now += HURT_IMMUNITY_MS;
        await report(b.socket, 1);
      }
      assert.equal(messages(b.p.userId, 'playground-hit').at(-1)!.health, 0);
      // the dead can neither be hit nor hit back
      await attack(a.socket, b.p.id, 0);
      await report(a.socket, 0);
      await attack(b.socket, a.p.id, 1);
      assert.equal(messages(a.p.userId, 'playground-hit').length, MAX_HEALTH);
      await handlers['playground-respawn']!(b.socket, {});
      assert.deepEqual(messages(a.p.userId, 'playground-health').at(-1), { t: 'playground-health', conversationId: 'playground-1', players: [{ id: b.p.id, health: MAX_HEALTH }] });
    } finally {
      Date.now = realNow;
    }
  });

  test('the first report of a session is answered with everyone\'s health', async () => {
    const a = connect(`a-${Math.random()}`, 'playground-1');
    const b = connect(`b-${Math.random()}`, 'playground-1');
    await report(b.socket, 1);
    await attack(a.socket, b.p.id, 0);
    await report(b.socket, 1, { first: true });
    const [health] = messages(b.p.userId, 'playground-health');
    assert.deepEqual(health!.players, [{ id: a.p.id, health: MAX_HEALTH }, { id: b.p.id, health: MAX_HEALTH - 1 }]);
  });
});
