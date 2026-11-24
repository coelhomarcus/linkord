import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { BLOCK, LANTERN, LOG_AXIS, TORCH_ON_FLOOR, TORCH_ON_WALL } from '../src/game/blocks.js';
import { BlockGrid } from '../src/game/grid.js';
import { GENERATOR_VERSION } from '../src/game/worldGen.js';
import { handleBreak, handleDigStart, handleInventoryOp, handlePlace, handleUse, handleWorldGet, clearBuilding, tickGame } from '../src/building.js';
import { clearCombat, handlePosition } from '../src/combat.js';
import { dropEverything, inventoryOf, setInventory, setInventoryStore } from '../src/inventories.js';
import { admit, clearRoster, type Player, type ServerMessage } from '../src/roster.js';
import { loadedWorld, setWorldStore, tickWorld, worldFor } from '../src/worlds.js';
import { memoryInventoryStore, memoryWorldStore } from '../src/worldStore.js';
import { createInventory, type Slot } from '../src/game/inventory.js';

const CALL = 'playground-1';
const GROUND = 10;

/** A flat world: stone up to GROUND - 1 with dirt on top, a crafting table and a furnace. */
function flatWorld() {
  const grid = new BlockGrid();
  for (let x = -16; x < 16; x++) {
    for (let z = -16; z < 16; z++) {
      for (let y = 0; y < GROUND - 1; y++) grid.set(x, y, z, BLOCK.stone);
      grid.set(x, GROUND - 1, z, BLOCK.dirt);
    }
  }
  grid.set(3, GROUND, 0, BLOCK.craftingTable);
  grid.set(-3, GROUND, 0, BLOCK.furnace);
  return { generator: GENERATOR_VERSION, blocks: grid.blocks, furnaces: [{ x: -3, y: GROUND, z: 0, facing: 0 }], items: [], clock: 30_000, states: null, chests: [] };
}

const sent = new Map<string, ServerMessage[]>();
let count = 0;

function connect(userId: string): Player {
  const id = `conn-${++count}`;
  sent.set(id, []);
  const player: Player = {
    id, userId, conversationId: CALL, expiresAt: Date.now() + 60_000,
    socket: { connected: true, emit: (t: string, msg: unknown) => { sent.get(id)!.push({ ...(msg as ServerMessage), t }); }, disconnect: () => {} },
  };
  admit(player);
  return player;
}

const messages = (player: Player, t: string) => sent.get(player.id)!.filter((m) => m.t === t);
const lastInventory = (player: Player) => messages(player, 'playground-inv').at(-1) as ServerMessage & { ack: number; inventory: { slots: Slot[]; open: unknown }; furnace?: { slots: Slot[] } };
const stand = (player: Player, x: number, z: number) => handlePosition(player, { x, y: GROUND, z, yaw: 0 });

async function give(player: Player, slots: Record<number, Slot>): Promise<void> {
  const holder = await inventoryOf(player);
  const all = [...createInventory().slots];
  for (const [index, slot] of Object.entries(slots)) all[Number(index)] = slot;
  setInventory(holder, { ...holder.inventory, slots: all });
}

describe('building', () => {
  beforeEach(async () => {
    const worlds = memoryWorldStore();
    await worlds.save(CALL, flatWorld());
    setWorldStore(worlds);
    setInventoryStore(memoryInventoryStore());
    await worldFor(CALL);
  });

  afterEach(() => {
    clearRoster();
    clearCombat();
    clearBuilding();
    sent.clear();
  });

  test('world-get hands over the blocks, deflated, and then the inventory', async () => {
    const player = connect('a');
    let answer: Record<string, unknown> = {};
    await handleWorldGet(player, {}, (reply) => { answer = reply; });
    const blocks = new BlockGrid(new Uint8Array(inflateRawSync(answer.blocks as Buffer)), new Uint8Array(inflateRawSync(answer.states as Buffer)));
    assert.equal(blocks.get(0, GROUND - 1, 0), BLOCK.dirt);
    // a world saved before states has them all 0, but for the creative chest it got on loading
    assert.deepEqual([...blocks.states].filter((state) => state !== 0), [blocks.stateAt(8, 30, 8)]);
    assert.equal(blocks.get(8, 30, 8), BLOCK.creativeChest);
    assert.deepEqual(answer.furnaces, [{ x: -3, y: GROUND, z: 0, facing: 0, lit: false }]);
    assert.equal(answer.clock, 30_000);
    assert.equal(lastInventory(player).ack, 0);
  });

  test('the clock runs with the world\'s ticks, is told to everyone now and then, and is saved', async () => {
    const player = connect('a');
    const world = loadedWorld(CALL)!;
    const start = world.tickedAt;
    tickWorld(world, start + 1000, () => {});
    assert.equal(world.clock, 30_020);
    assert.equal(messages(player, 'playground-time').length, 0);
    tickWorld(world, start + 61_000, () => {});
    assert.deepEqual(messages(player, 'playground-time').at(-1)?.clock, world.clock);
  });

  test('a block dug long enough breaks for everyone and drops what it is made of', async () => {
    const digger = connect('a');
    const watcher = connect('b');
    await stand(digger, 0.5, 2.5);
    handleDigStart(digger, { x: 0, y: GROUND - 1, z: 0 });
    // dirt takes 15 ticks by hand: at once is too soon
    await handleBreak(digger, { seq: 1, x: 0, y: GROUND - 1, z: 0 });
    assert.deepEqual(messages(digger, 'playground-blocks').at(-1)?.changes, [[0, GROUND - 1, 0, BLOCK.dirt]]);
    assert.equal(messages(watcher, 'playground-blocks').length, 0);
    assert.equal(lastInventory(digger).ack, 1);

    const world = loadedWorld(CALL)!;
    handleDigStart(digger, { x: 0, y: GROUND - 1, z: 0 });
    const dig = Date.now();
    const realNow = Date.now;
    Date.now = () => dig + 1000;
    try {
      await handleBreak(digger, { seq: 2, x: 0, y: GROUND - 1, z: 0 });
    } finally {
      Date.now = realNow;
    }
    assert.equal(world.grid.get(0, GROUND - 1, 0), BLOCK.air);
    assert.deepEqual(messages(watcher, 'playground-blocks').at(-1)?.changes, [[0, GROUND - 1, 0, BLOCK.air]]);
    const [drop] = [...world.items.values()];
    assert.deepEqual(drop?.stack, { item: 'dirt', count: 1 });
    assert.equal(messages(watcher, 'playground-items').length, 1);
  });

  test('items on the ground go to whoever stands by them, once they may', async () => {
    const player = connect('a');
    await stand(player, 0.5, 0.5);
    await inventoryOf(player);
    const world = loadedWorld(CALL)!;
    dropEverything(player, { x: 0.5, y: GROUND, z: 0.5 }, () => 0);
    // nothing to drop yet
    assert.equal(world.items.size, 0);
    await give(player, { 0: { item: 'cobblestone', count: 5 } });
    dropEverything(player, { x: 0.5, y: GROUND, z: 0.5 }, () => 0);
    assert.equal(world.items.size, 1);
    tickGame(Date.now());
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(world.items.size, 1, 'a thrown stack waits before anyone picks it up');
    const realNow = Date.now;
    Date.now = () => realNow() + 3000;
    try {
      tickGame(Date.now());
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      Date.now = realNow;
    }
    assert.equal(world.items.size, 0);
    assert.deepEqual(lastInventory(player).inventory.slots[0], { item: 'cobblestone', count: 5 });
  });

  test('a held block is placed within reach, never inside someone', async () => {
    const builder = connect('a');
    const other = connect('b');
    await stand(builder, 0.5, 0.5);
    await stand(other, 2.5, 0.5);
    await give(builder, { 0: { item: 'cobblestone', count: 2 } });
    const world = loadedWorld(CALL)!;
    await handlePlace(builder, { seq: 1, x: 1, y: GROUND, z: 0 });
    assert.equal(world.grid.get(1, GROUND, 0), BLOCK.cobblestone);
    assert.deepEqual(lastInventory(builder).inventory.slots[0], { item: 'cobblestone', count: 1 });
    await handlePlace(builder, { seq: 2, x: 2, y: GROUND, z: 0 });
    assert.equal(world.grid.get(2, GROUND, 0), BLOCK.air, 'someone stands there');
    await handlePlace(builder, { seq: 3, x: 12, y: GROUND, z: 0 });
    assert.equal(world.grid.get(12, GROUND, 0), BLOCK.air, 'out of reach');
    await handlePlace(builder, { seq: 4, x: 0, y: GROUND + 5, z: 0 });
    assert.equal(world.grid.get(0, GROUND + 5, 0), BLOCK.air, 'against nothing');
    assert.equal(lastInventory(builder).ack, 4);
  });

  test('a log placed against a side lies along it, and everyone hears its state', async () => {
    const builder = connect('a');
    const watcher = connect('b');
    await stand(builder, 0.5, 0.5);
    await give(builder, { 0: { item: 'oak_log', count: 3 } });
    const world = loadedWorld(CALL)!;
    // on the ground, against its top: it stands up, and a state of 0 goes unsaid
    await handlePlace(builder, { seq: 1, x: 1, y: GROUND, z: 1, face: 2 });
    assert.equal(world.grid.stateAt(1, GROUND, 1), LOG_AXIS.y);
    assert.deepEqual(messages(watcher, 'playground-blocks').at(-1)?.changes, [[1, GROUND, 1, BLOCK.log]]);
    await handlePlace(builder, { seq: 2, x: 2, y: GROUND, z: 1, face: 0 });
    assert.equal(world.grid.stateAt(2, GROUND, 1), LOG_AXIS.x);
    assert.deepEqual(messages(watcher, 'playground-blocks').at(-1)?.changes, [[2, GROUND, 1, BLOCK.log, LOG_AXIS.x]]);
    // a tab from before states says no face: it stands up
    await handlePlace(builder, { seq: 3, x: 1, y: GROUND, z: 2 });
    assert.equal(world.grid.stateAt(1, GROUND, 2), LOG_AXIS.y);
    // broken, the cell forgets the state
    world.grid.set(2, GROUND, 1, BLOCK.air);
    assert.equal(world.grid.stateAt(2, GROUND, 1), 0);
  });

  test('a torch stands on a floor or sticks out of a wall, and never hangs on nothing', async () => {
    const builder = connect('a');
    const watcher = connect('b');
    await stand(builder, 0.5, 0.5);
    await give(builder, { 0: { item: 'torch', count: 4 } });
    const world = loadedWorld(CALL)!;
    // on the ground, against its top
    await handlePlace(builder, { seq: 1, x: 1, y: GROUND, z: 1, face: 2 });
    assert.equal(world.grid.get(1, GROUND, 1), BLOCK.torch);
    assert.equal(world.grid.stateAt(1, GROUND, 1), TORCH_ON_FLOOR);
    // on the crafting table's -x side (3, GROUND, 0): it points -x, away from it
    await handlePlace(builder, { seq: 2, x: 2, y: GROUND, z: 0, face: 1 });
    assert.equal(world.grid.stateAt(2, GROUND, 0), TORCH_ON_WALL + 1);
    assert.deepEqual(messages(watcher, 'playground-blocks').at(-1)?.changes, [[2, GROUND, 0, BLOCK.torch, TORCH_ON_WALL + 1]]);
    // against the torch itself (it holds nothing up), with no floor or wall round the cell: refused
    await handlePlace(builder, { seq: 3, x: 1, y: GROUND + 1, z: 1, face: 2 });
    assert.equal(world.grid.get(1, GROUND + 1, 1), BLOCK.air);
    assert.deepEqual(messages(builder, 'playground-blocks').at(-1)?.changes, [[1, GROUND + 1, 1, BLOCK.air]]);
    assert.deepEqual(lastInventory(builder).inventory.slots[0], { item: 'torch', count: 2 });
  });

  test('breaking what holds a torch or lantern up breaks it too, dropping both', async () => {
    const builder = connect('a');
    const watcher = connect('b');
    await stand(builder, 0.5, 0.5);
    await give(builder, { 0: { item: 'torch', count: 1 }, 1: { item: 'lantern', count: 1 }, 2: { item: 'cobblestone', count: 1 } });
    const world = loadedWorld(CALL)!;
    // a torch on a cobblestone's +z side, and a lantern under a block it hangs from
    world.grid.set(0, GROUND, 2, BLOCK.cobblestone);
    world.grid.set(-1, GROUND + 2, 0, BLOCK.cobblestone);
    await handlePlace(builder, { seq: 1, x: 0, y: GROUND, z: 3, face: 4 });
    assert.equal(world.grid.stateAt(0, GROUND, 3), TORCH_ON_WALL + 0);
    await handleInventoryOp(builder, { seq: 2, op: { op: 'select', slot: 1 } });
    await handlePlace(builder, { seq: 3, x: -1, y: GROUND + 1, z: 0, face: 3 });
    assert.equal(world.grid.get(-1, GROUND + 1, 0), BLOCK.lantern);
    assert.equal(world.grid.stateAt(-1, GROUND + 1, 0), LANTERN.hanging);

    // the cobblestone goes: so does the torch on it
    handleDigStart(builder, { x: 0, y: GROUND, z: 2 });
    const dig = Date.now();
    const realNow = Date.now;
    Date.now = () => dig + 20_000;
    try {
      await handleBreak(builder, { seq: 4, x: 0, y: GROUND, z: 2 });
      handleDigStart(builder, { x: -1, y: GROUND + 2, z: 0 });
      Date.now = () => dig + 40_000;
      await handleBreak(builder, { seq: 5, x: -1, y: GROUND + 2, z: 0 });
    } finally {
      Date.now = realNow;
    }
    assert.equal(world.grid.get(0, GROUND, 3), BLOCK.air);
    assert.equal(world.grid.get(-1, GROUND + 1, 0), BLOCK.air);
    const blocks = messages(watcher, 'playground-blocks').map((m) => m.changes);
    assert.ok(blocks.some((changes) => JSON.stringify(changes) === JSON.stringify([[0, GROUND, 3, BLOCK.air]])));
    assert.ok(blocks.some((changes) => JSON.stringify(changes) === JSON.stringify([[-1, GROUND + 1, 0, BLOCK.air]])));
    // the cobblestones, dug by hand, drop nothing; what fell off them drops itself, whatever is held
    const drops = [...world.items.values()].map((item) => item.stack.item).sort();
    assert.deepEqual(drops, ['lantern', 'torch']);
  });

  test('a world keeps its states through a save', async () => {
    const world = loadedWorld(CALL)!;
    world.grid.set(4, GROUND, 4, BLOCK.log, LOG_AXIS.z);
    const store = memoryWorldStore();
    setWorldStore(store);
    await store.save(CALL, { generator: GENERATOR_VERSION, blocks: world.grid.blocks, states: world.grid.states, furnaces: [], chests: [], items: [], clock: 0 });
    const loaded = await worldFor(CALL);
    assert.equal(loaded.grid.stateAt(4, GROUND, 4), LOG_AXIS.z);
  });

  test('a chest faces whoever placed it, keeps what is put in it for everyone, and spills it when broken', async () => {
    const builder = connect('a');
    const other = connect('b');
    await stand(builder, 0.5, 2.5);
    await stand(other, 1.5, -1.5);
    await give(builder, { 0: { item: 'chest', count: 1 }, 1: { item: 'diamond', count: 3 } });
    const world = loadedWorld(CALL)!;
    await handlePlace(builder, { seq: 1, x: 0, y: GROUND, z: 0, face: 2 });
    assert.equal(world.grid.get(0, GROUND, 0), BLOCK.chest);
    assert.equal(world.grid.stateAt(0, GROUND, 0), 0, 'it faces +z, toward the builder');

    await handleUse(builder, { seq: 2, x: 0, y: GROUND, z: 0 });
    assert.deepEqual(lastInventory(builder).inventory.open, { kind: 'chest', x: 0, y: GROUND, z: 0 });
    await handleUse(other, { seq: 1, x: 0, y: GROUND, z: 0 });
    await handleInventoryOp(builder, { seq: 3, op: { op: 'click', slot: { area: 'inv', index: 1 }, button: 'left', shift: true } });
    const seen = (player: Player) => (messages(player, 'playground-inv').at(-1) as unknown as { chest?: Slot[] }).chest;
    assert.deepEqual(seen(builder)?.[0], { item: 'diamond', count: 3 });
    assert.deepEqual(seen(other)?.[0], { item: 'diamond', count: 3 }, 'the other viewer sees it too');

    const realNow = Date.now;
    handleDigStart(builder, { x: 0, y: GROUND, z: 0 });
    const dig = Date.now();
    Date.now = () => dig + 10_000;
    try {
      await handleBreak(builder, { seq: 4, x: 0, y: GROUND, z: 0 });
    } finally {
      Date.now = realNow;
    }
    assert.equal(world.grid.get(0, GROUND, 0), BLOCK.air);
    assert.equal(world.chests.size, 0);
    const lying = [...world.items.values()].map((item) => item.stack.item).sort();
    assert.deepEqual(lying, ['chest', 'diamond']);
    assert.equal(lastInventory(other).inventory.open, null, 'its screen closed for whoever had it open');
  });

  test('the creative chest stands by the plaza, never breaks, and gives any item', async () => {
    const world = loadedWorld(CALL)!;
    const at = { x: 8, y: 30, z: 8 };
    assert.equal(world.grid.get(at.x, at.y, at.z), BLOCK.creativeChest, 'a world from before it gets one');
    const player = connect('a');
    await handlePosition(player, { x: 8.5, y: 30, z: 10.5, yaw: 0 });
    handleDigStart(player, at);
    await handleBreak(player, { seq: 1, ...at });
    assert.equal(world.grid.get(at.x, at.y, at.z), BLOCK.creativeChest);
    await handleUse(player, { seq: 2, ...at });
    assert.equal((lastInventory(player).inventory.open as { kind?: string } | null)?.kind, 'creative');
    await handleInventoryOp(player, { seq: 3, op: { op: 'creative', item: 'golden_axe', button: 'left', shift: true } });
    assert.deepEqual(lastInventory(player).inventory.slots[0], { item: 'golden_axe', count: 1 });
  });

  test('a furnace opens, takes ore and coal, and smelts on its own', async () => {
    const player = connect('a');
    await stand(player, -1.5, 0.5);
    await give(player, { 0: { item: 'iron_ore', count: 2 }, 1: { item: 'coal', count: 1 } });
    await handleUse(player, { seq: 1, x: -3, y: GROUND, z: 0 });
    assert.deepEqual(lastInventory(player).inventory.open, { kind: 'furnace', x: -3, y: GROUND, z: 0 });
    await handleInventoryOp(player, { seq: 2, op: { op: 'click', slot: { area: 'inv', index: 0 }, button: 'left', shift: true } });
    await handleInventoryOp(player, { seq: 3, op: { op: 'click', slot: { area: 'inv', index: 1 }, button: 'left', shift: true } });
    assert.deepEqual(lastInventory(player).furnace?.slots, [{ item: 'iron_ore', count: 2 }, { item: 'coal', count: 1 }, null]);
    const world = loadedWorld(CALL)!;
    world.tickedAt -= 10_500;
    tickGame(Date.now());
    assert.deepEqual(world.furnaces.get(`-3,${GROUND},0`)?.state.slots, [{ item: 'iron_ore', count: 1 }, null, { item: 'iron_ingot', count: 1 }]);
    assert.deepEqual(lastInventory(player).furnace?.slots[2], { item: 'iron_ingot', count: 1 });
  });

  test('a crafting table opens a 3×3 grid', async () => {
    const player = connect('a');
    await stand(player, 1.5, 0.5);
    await handleUse(player, { seq: 1, x: 3, y: GROUND, z: 0 });
    const { inventory } = lastInventory(player) as unknown as { inventory: { open: unknown; grid: unknown[] } };
    assert.deepEqual([inventory.open, inventory.grid.length], [{ kind: 'table', x: 3, y: GROUND, z: 0 }, 9]);
  });
});
