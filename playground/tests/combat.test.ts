import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  attackDamage, clearCombat, createFighter, FIGHTER_KEEP_MS, handleAttack, handlePosition, handleRespawn, healthOf, HURT_IMMUNITY_MS, killReward,
  knockbackFor, landHit, levelOf, MAX_ATTACK_DISTANCE, MAX_HEALTH, playerJoined, playerLeft, readPosition, REGEN_INTERVAL_MS, setExperienceStore,
  sweepFighters, withinReach,
} from '../src/combat.js';
import { admit, clearRoster, remove, type Player, type ServerMessage } from '../src/roster.js';
import { memoryExperienceStore } from '../src/experience.js';

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

describe('experience', () => {
  test('levels follow the game\'s curve', () => {
    assert.equal(levelOf(0), 0);
    assert.equal(levelOf(6), 0);
    assert.equal(levelOf(7), 1);
    assert.equal(levelOf(7 + 9), 2);
    // 315 points is level 15, 1395 level 30, as in the game
    assert.equal(levelOf(315), 15);
    assert.equal(levelOf(314), 14);
    assert.equal(levelOf(1395), 30);
  });

  test('a kill earns 7 points per level of the one killed, at least 7 and at most 100', () => {
    assert.equal(killReward(0), 7);
    assert.equal(killReward(352), 100);
    assert.equal(killReward(7 + 9 + 11), 21);
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
  const sent = new Map<string, ServerMessage[]>();
  let count = 0;

  function connect(userId: string, conversationId: string, id = `conn-${++count}`): Player {
    sent.set(id, []);
    const player: Player = {
      id, userId, conversationId, expiresAt: Date.now() + 60_000,
      socket: { connected: true, emit: (t: string, msg: unknown) => { sent.get(id)!.push({ ...(msg as ServerMessage), t }); }, disconnect: () => {} },
    };
    admit(player);
    playerJoined(player);
    return player;
  }

  const healthIn = (message: ServerMessage, id: string) => (message.players as { id: string; health: number }[]).find((p) => p.id === id)?.health;
  const messages = (player: Player, t: string) => sent.get(player.id)!.filter((m) => m.t === t);
  const report = (player: Player, x: number, extra: Record<string, unknown> = {}) => handlePosition(player, { x, y: 10, z: 0, yaw: 0, ...extra });
  const attack = (player: Player, targetId: string, x: number, extra: Record<string, unknown> = {}) =>
    handleAttack(player, { targetId, x, y: 10, z: 0, yaw: Math.PI / 2, crit: false, sprint: false, ...extra });

  afterEach(() => {
    clearRoster();
    clearCombat();
    sent.clear();
  });

  test('a hit in reach reaches everyone in the call, with the knockback', async () => {
    const a = connect('a', 'playground-1');
    const b = connect('b', 'playground-1');
    await report(b, 2);
    await attack(a, b.id, 0, { sprint: true });
    for (const who of [a, b]) {
      const [hit] = messages(who, 'playground-hit');
      assert.deepEqual(hit, {
        t: 'playground-hit', conversationId: 'playground-1', attackerId: a.id, targetId: b.id,
        damage: 1, health: 19, crit: false, hurt: true, push: [0.4, 0], extra: [0.5, 0.1, 0],
      });
    }
  });

  test('no hit from too far, on someone who never reported, or in another call', async () => {
    const a = connect('a', 'playground-1');
    const far = connect('far', 'playground-1');
    const silent = connect('silent', 'playground-1');
    const elsewhere = connect('else', 'playground-2');
    await report(far, 20);
    await report(elsewhere, 1);
    await attack(a, far.id, 0);
    await attack(a, silent.id, 0);
    await attack(a, elsewhere.id, 0);
    for (const player of [a, far, silent, elsewhere]) assert.deepEqual(messages(player, 'playground-hit'), []);
  });

  test('a death stops the fighting until the respawn, which heals', async () => {
    const a = connect('a', 'playground-1');
    const b = connect('b', 'playground-1');
    await report(b, 1);
    const realNow = Date.now;
    let now = realNow();
    Date.now = () => now;
    try {
      for (let i = 0; i < MAX_HEALTH; i++) {
        await attack(a, b.id, 0);
        now += HURT_IMMUNITY_MS;
        await report(b, 1);
      }
      assert.equal(messages(b, 'playground-hit').at(-1)!.health, 0);
      assert.deepEqual(messages(a, 'playground-xp'), [{ t: 'playground-xp', conversationId: 'playground-1', xp: 7 }]);
      assert.deepEqual(messages(b, 'playground-xp'), []);
      // the dead can neither be hit nor hit back
      await attack(a, b.id, 0);
      await report(a, 0);
      await attack(b, a.id, 1);
      assert.equal(messages(a, 'playground-hit').length, MAX_HEALTH);
      handleRespawn(b);
      assert.deepEqual(messages(a, 'playground-health').at(-1), { t: 'playground-health', conversationId: 'playground-1', players: [{ id: b.id, health: MAX_HEALTH }] });
    } finally {
      Date.now = realNow;
    }
  });

  test('the first report of a connection is answered with everyone\'s health and its experience', async () => {
    const store = memoryExperienceStore();
    await store.add('playground-1', 'b', 30);
    setExperienceStore(store);
    const a = connect('a', 'playground-1');
    const b = connect('b', 'playground-1');
    await report(b, 1);
    await attack(a, b.id, 0);
    await report(b, 1, { first: true });
    const [health] = messages(b, 'playground-health');
    assert.deepEqual(health!.players, [{ id: a.id, health: MAX_HEALTH }, { id: b.id, health: MAX_HEALTH - 1 }]);
    assert.deepEqual(messages(b, 'playground-xp'), [{ t: 'playground-xp', conversationId: 'playground-1', xp: 30 }]);
  });

  test('a kill adds to the experience the store already had', async () => {
    const store = memoryExperienceStore();
    await store.add('playground-1', 'a', 10);
    setExperienceStore(store);
    const a = connect('a', 'playground-1');
    const b = connect('b', 'playground-1');
    await report(b, 1);
    await attack(a, b.id, 0, { crit: true });
    const realNow = Date.now;
    let now = realNow();
    Date.now = () => now;
    try {
      for (let i = 0; i < MAX_HEALTH; i++) {
        now += HURT_IMMUNITY_MS;
        await attack(a, b.id, 0);
      }
    } finally {
      Date.now = realNow;
    }
    assert.deepEqual(messages(a, 'playground-xp').at(-1), { t: 'playground-xp', conversationId: 'playground-1', xp: 17 });
    assert.equal(await store.load('playground-1', 'a'), 17);
  });

  test('health outlives a reconnect, but not a long absence', async () => {
    const a = connect('a', 'playground-1');
    const b = connect('b', 'playground-1', 'conn-b');
    await report(b, 1);
    await attack(a, b.id, 0);
    remove(b);
    playerLeft(b, Date.now());
    const again = connect('b', 'playground-1', 'conn-b');
    await report(again, 1, { first: true });
    assert.equal(healthIn(messages(again, 'playground-health')[0]!, 'conn-b'), MAX_HEALTH - 1);
    remove(again);
    playerLeft(again, 0);
    sweepFighters(FIGHTER_KEEP_MS + 1);
    const later = connect('b', 'playground-1', 'conn-b');
    await report(later, 1, { first: true });
    assert.equal(healthIn(messages(later, 'playground-health')[0]!, 'conn-b'), MAX_HEALTH);
  });

  test('a replaced connection is ignored', async () => {
    const a = connect('a', 'playground-1', 'conn-a');
    const b = connect('b', 'playground-1');
    await report(b, 1);
    connect('a', 'playground-1', 'conn-a');
    await attack(a, b.id, 0);
    assert.deepEqual(messages(b, 'playground-hit'), []);
  });
});
