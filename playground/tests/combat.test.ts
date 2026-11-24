import { test, describe, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  attackDamage, checkedFall, clearCombat, createFighter, FIGHTER_KEEP_MS, handleAttack, handleEat, handleEatStart, handlePosition, handleRespawn, healthOf,
  HURT_IMMUNITY_MS, killReward, knockbackFor, landHit, levelOf, MAX_ATTACK_DISTANCE, MAX_HEALTH, playerJoined, playerLeft, readPosition, setExperienceStore,
  stepVitals, sweepFighters, TICK_MS, tickVitals, withinReach,
} from '../src/combat.js';
import { admit, clearRoster, remove, type Player, type ServerMessage } from '../src/roster.js';
import { memoryExperienceStore } from '../src/experience.js';
import { BLOCK } from '../src/game/blocks.js';
import { BlockGrid } from '../src/game/grid.js';
import { createInventory, type Slot } from '../src/game/inventory.js';
import { FOOD_TICKS, MAX_AIR } from '../src/game/vitals.js';
import { GENERATOR_VERSION } from '../src/game/worldGen.js';
import { inventoryOf, setInventory, setInventoryStore } from '../src/inventories.js';
import { setWorldStore, worldFor } from '../src/worlds.js';
import { memoryInventoryStore, memoryWorldStore } from '../src/worldStore.js';

describe('health', () => {
  test('a bare hand takes half a heart, a critical one and a half times that', () => {
    assert.equal(attackDamage(false), 1);
    assert.equal(attackDamage(true), 1.5);
  });

  test('comes back a point every 80 ticks with 18 food or more, and not below', () => {
    const fighter = createFighter('c', 0);
    landHit(fighter, 5, 0);
    assert.equal(healthOf(fighter), MAX_HEALTH - 5);
    const heals = Array.from({ length: FOOD_TICKS * 2 }, () => stepVitals(fighter, false).hunger).filter((change) => change === 'heal');
    assert.equal(heals.length, 2);
    fighter.hunger.food = 17;
    assert.deepEqual(Array.from({ length: FOOD_TICKS * 2 }, () => stepVitals(fighter, false).hunger).filter(Boolean), []);
  });

  test('a fall counts no higher than the heights reported before it', () => {
    const fighter = createFighter('c', 0);
    fighter.heights = [{ y: 20, at: 0 }, { y: 30, at: 1000 }];
    assert.equal(checkedFall(fighter, 10, 20, 2000), 10);
    // a little over is a report that missed the top of a jump
    assert.equal(checkedFall(fighter, 40, 20, 2000), 10.5);
    // a height from long ago does not count
    assert.equal(checkedFall(fighter, 40, 20, 12_000), 0.5);
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

describe('the world hurts', () => {
  const CALL = 'playground-1';
  const GROUND = 10;
  const sent = new Map<string, ServerMessage[]>();
  let count = 0;
  let now = 0;
  const realNow = Date.now;

  /** Flat ground at GROUND, with a pool three deep at x 4..7. */
  function pondWorld() {
    const grid = new BlockGrid();
    for (let x = -8; x < 8; x++) {
      for (let z = -8; z < 8; z++) {
        for (let y = 0; y < GROUND; y++) grid.set(x, y, z, x >= 4 && y >= GROUND - 3 ? BLOCK.water : BLOCK.stone);
      }
    }
    return { generator: GENERATOR_VERSION, blocks: grid.blocks, furnaces: [], items: [], clock: 0, states: null, chests: [] };
  }

  function connect(userId: string): Player {
    const id = `conn-${++count}`;
    sent.set(id, []);
    const player: Player = {
      id, userId, conversationId: CALL, expiresAt: realNow() + 60_000,
      socket: { connected: true, emit: (t: string, msg: unknown) => { sent.get(id)!.push({ ...(msg as ServerMessage), t }); }, disconnect: () => {} },
    };
    admit(player);
    playerJoined(player);
    return player;
  }

  const messages = (player: Player, t: string) => sent.get(player.id)!.filter((m) => m.t === t);
  const stand = (player: Player, x: number, y: number, extra: Record<string, unknown> = {}) => handlePosition(player, { x, y, z: 0, yaw: 0, ...extra });
  /** The game runs on for `ms`. */
  function wait(ms: number): void {
    const end = now + ms;
    while (now < end) {
      now = Math.min(end, now + 100);
      tickVitals(now);
    }
  }
  const lastVitals = (player: Player) => messages(player, 'playground-vitals').at(-1) as ServerMessage & { food: number; saturation: number };

  /** Sprints back and forth until the food is down to `food`. */
  async function goHungry(player: Player, food: number): Promise<void> {
    for (let i = 0; i < 400 && lastVitals(player)!.food > food; i++) {
      now += 1000;
      await stand(player, i % 2 ? 0.5 : -7.5, GROUND, { sprinted: 8 });
      wait(TICK_MS * 2);
    }
  }

  async function give(player: Player, slots: Record<number, Slot>): Promise<void> {
    const holder = await inventoryOf(player);
    const all = [...createInventory().slots];
    for (const [index, slot] of Object.entries(slots)) all[Number(index)] = slot;
    setInventory(holder, { ...holder.inventory, slots: all });
  }

  beforeEach(async () => {
    const worlds = memoryWorldStore();
    await worlds.save(CALL, pondWorld());
    setWorldStore(worlds);
    setInventoryStore(memoryInventoryStore());
    await worldFor(CALL);
    now = realNow();
    Date.now = () => now;
  });

  afterEach(() => {
    Date.now = realNow;
    clearRoster();
    clearCombat();
    sent.clear();
  });

  test('a fall past three blocks hurts on landing, for everyone to see, and none into water', async () => {
    const a = connect('a');
    const b = connect('b');
    await stand(a, 0.5, GROUND + 10, { first: true });
    now += 1000;
    await stand(a, 0.5, GROUND, { fall: 10 });
    const [hit] = messages(b, 'playground-hit');
    assert.deepEqual(hit, {
      t: 'playground-hit', conversationId: CALL, attackerId: null, targetId: a.id, damage: 7, health: MAX_HEALTH - 7, crit: false, hurt: true, cause: 'fall',
    });
    // a fall that claims more than the heights seen counts only those
    now += 1000;
    await stand(a, 0.5, GROUND + 5);
    now += 1000;
    await stand(a, 0.5, GROUND, { fall: 50 });
    assert.equal(messages(a, 'playground-hit').at(-1)!.damage, 3);
    // into the pool: nothing
    now += 1000;
    await stand(a, 5.5, GROUND + 10);
    now += 1000;
    await stand(a, 5.5, GROUND - 2, { fall: 12 });
    assert.equal(messages(a, 'playground-hit').length, 2);
  });

  test('a head under water drowns, 2 a second, once its 15 s of air are gone', async () => {
    const a = connect('a');
    await stand(a, 5.5, GROUND - 3, { first: true });
    wait(MAX_AIR * TICK_MS);
    assert.deepEqual(messages(a, 'playground-hit'), []);
    wait(1000);
    const [hit] = messages(a, 'playground-hit');
    assert.deepEqual([hit!.cause, hit!.damage, hit!.attackerId], ['drown', 2, null]);
    // a full stomach heals a point every 4 s meanwhile, not enough
    wait(15_000);
    assert.equal(messages(a, 'playground-hit').at(-1)!.health, 0);
    // out of the water, the air is back at once
    handleRespawn(a);
    const hits = messages(a, 'playground-hit').length;
    await stand(a, 5.5, GROUND + 1);
    wait(1000);
    await stand(a, 5.5, GROUND - 3);
    wait(MAX_AIR * TICK_MS);
    assert.equal(messages(a, 'playground-hit').length, hits);
  });

  test('health comes back only with 18 food or more, each point sent to the call', async () => {
    const a = connect('a');
    const b = connect('b');
    await stand(a, 0.5, GROUND, { first: true });
    await stand(b, 1.5, GROUND);
    await handleAttack(b, { targetId: a.id, x: 1.5, y: GROUND, z: 0, yaw: 0, crit: false, sprint: false });
    wait(FOOD_TICKS * TICK_MS);
    assert.deepEqual(messages(b, 'playground-health').at(-1), { t: 'playground-health', conversationId: CALL, players: [{ id: a.id, health: MAX_HEALTH }] });
    await handleAttack(b, { targetId: a.id, x: 1.5, y: GROUND, z: 0, yaw: 0, crit: false, sprint: false });
    await goHungry(a, 17);
    const healed = messages(b, 'playground-health').length;
    wait(FOOD_TICKS * TICK_MS * 3);
    assert.equal(messages(b, 'playground-health').length, healed);
  });

  test('sprinting runs the food down, and at 0 it starves', async () => {
    const a = connect('a');
    await stand(a, 0.5, GROUND, { first: true });
    assert.deepEqual(lastVitals(a), { t: 'playground-vitals', conversationId: CALL, food: 20, saturation: 5 });
    await goHungry(a, 0);
    assert.equal(lastVitals(a)!.food, 0);
    wait(FOOD_TICKS * TICK_MS);
    const [hit] = messages(a, 'playground-hit');
    assert.deepEqual([hit!.cause, hit!.damage], ['starve', 1]);
    // on hard, down to death
    wait(FOOD_TICKS * TICK_MS * MAX_HEALTH);
    assert.equal(messages(a, 'playground-hit').at(-1)!.health, 0);
    handleRespawn(a);
    assert.deepEqual(lastVitals(a), { t: 'playground-vitals', conversationId: CALL, food: 20, saturation: 5 });
  });

  test('eating takes the button held for 32 ticks on food, and not when full', async () => {
    const a = connect('a');
    await stand(a, 0.5, GROUND, { first: true });
    await give(a, { 0: { item: 'apple', count: 2 } });
    // full: nothing
    await handleEatStart(a);
    now += 2000;
    await handleEat(a, { seq: 1 });
    assert.equal((await inventoryOf(a)).inventory.slots[0]!.count, 2);
    await goHungry(a, 15);
    const food = lastVitals(a)!.food;
    // too soon
    await handleEatStart(a);
    now += 500;
    await handleEat(a, { seq: 2 });
    assert.equal((await inventoryOf(a)).inventory.slots[0]!.count, 2);
    await handleEatStart(a);
    now += 32 * TICK_MS;
    await handleEat(a, { seq: 3 });
    assert.equal((await inventoryOf(a)).inventory.slots[0]!.count, 1);
    assert.equal(lastVitals(a)!.food, food + 4);
    assert.equal(messages(a, 'playground-inv').at(-1)!.ack, 3);
  });
});
