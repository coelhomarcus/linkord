import { deflateRawSync } from 'node:zlib';
import { BLOCK, type Block } from './game/blocks.js';
import { advanceClock, NEW_WORLD_TIME, readClock } from './game/dayTime.js';
import { PICKUP_DELAY_MS, DESPAWN_MS, restingPlace, type Motion } from './game/drops.js';
import { BlockGrid } from './game/grid.js';
import { CHEST_SIZE, parseChest, parseFurnace, parseStack, type ItemStack, type Slot } from './game/inventory.js';
import { createFurnace, furnaceActive, stepFurnace, type FurnaceState } from './game/smelting.js';
import { generateWorld, GENERATOR_VERSION, placeCreativeChest, type Facing } from './game/worldGen.js';
import { memoryWorldStore, type WorldStore } from './worldStore.js';
import { sendToCall } from './roster.js';
import { logger } from './logger.js';

const log = logger.child({ component: 'worlds' });

// Each playground's world, the one that counts: its blocks, its furnaces and the
// items lying on its ground. It is generated the first time someone visits
// (game/worldGen.ts), loaded from the database after that, kept in memory while
// anyone is in the call and for a while after, and saved a few seconds after it
// changes, when its last player leaves and when the service stops. Every change
// goes to everyone in the call at once (`playground-blocks`, `playground-items`,
// `playground-furnace`); what may change is building.ts's to decide. Its clock
// (game/dayTime.ts) runs with its ticks, only while it is loaded; browsers count
// on from what `world-get` said and hear it again now and then (`playground-time`).

/** a changed world is saved this soon after its first unsaved change */
const SAVE_AFTER_MS = 10_000;
/** a world nobody is in stays loaded this long */
const UNLOAD_AFTER_MS = 2 * 60 * 1000;
/** a tick late by more than this (a stalled process) runs only this much */
const MAX_CATCH_UP_TICKS = 20 * 60;
/** more items than this on the ground, and the oldest go */
const MAX_ITEMS = 400;
/** what a furnace's viewers hear while it works, besides every change of its slots */
const FURNACE_REFRESH_MS = 1000;
/** how often everyone in a world hears its clock, against the drift of their own */
const CLOCK_REFRESH_MS = 60_000;
const TICK_MS = 50;

export interface DroppedItem {
  id: number;
  stack: ItemStack;
  /** where its fall started and how it was thrown: every client plays the same fall */
  start: Motion;
  /** where it comes to rest */
  x: number;
  y: number;
  z: number;
  spawnedAt: number;
  pickupAt: number;
}

export interface Furnace {
  x: number;
  y: number;
  z: number;
  facing: Facing;
  state: FurnaceState;
  lit: boolean;
  /** when its viewers last heard how it is doing */
  shownAt: number;
}

/** What a chest holds, by where it stands. */
export interface Chest {
  x: number;
  y: number;
  z: number;
  slots: Slot[];
}

export interface World {
  conversationId: string;
  grid: BlockGrid;
  furnaces: Map<string, Furnace>;
  chests: Map<string, Chest>;
  items: Map<number, DroppedItem>;
  nextItemId: number;
  /** when the first change since the last save was made, or null when saved */
  dirtySince: number | null;
  /** bumped by every block change, so the compressed copy for newcomers is made again */
  version: number;
  packed: { version: number; blocks: Buffer; states: Buffer } | null;
  /** when its last player left, or null while someone is in */
  emptySince: number | null;
  /** the time of its last game tick */
  tickedAt: number;
  /** its clock in ticks: the time of day and the moon's phase */
  clock: number;
  /** when everyone in it last heard the clock */
  clockShownAt: number;
}

const furnaceKey = (x: number, y: number, z: number) => `${x},${y},${z}`;

const worlds = new Map<string, World>();
const loading = new Map<string, Promise<World>>();
let store: WorldStore = memoryWorldStore();

/** index.ts hands in the database; tests keep the memory one, and start over with a fresh one. */
export function setWorldStore(next: WorldStore): void {
  store = next;
  worlds.clear();
  loading.clear();
}

export function loadedWorld(conversationId: string): World | null {
  return worlds.get(conversationId) ?? null;
}

export function loadedWorlds(): IterableIterator<World> {
  return worlds.values();
}

function readFurnaces(value: unknown): Furnace[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: Record<string, unknown>) => {
    const { x, y, z, facing } = entry ?? {};
    if (![x, y, z].every((n) => typeof n === 'number' && Number.isInteger(n)) || !BlockGrid.inside(x as number, y as number, z as number)) return [];
    const state = parseFurnace(entry.state);
    return [{ x: x as number, y: y as number, z: z as number, facing: ([0, 1, 2, 3].includes(facing as number) ? facing : 0) as Facing, state, lit: state.burn > 0, shownAt: 0 }];
  });
}

function readChests(value: unknown, grid: BlockGrid): Chest[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: Record<string, unknown>) => {
    const { x, y, z } = entry ?? {};
    if (!isCell(x, y, z) || grid.get(x as number, y as number, z as number) !== BLOCK.chest) return [];
    return [{ x: x as number, y: y as number, z: z as number, slots: parseChest(entry.slots) }];
  });
}

function readItems(value: unknown, now: number): DroppedItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: Record<string, unknown>, i) => {
    const stack = parseStack(entry?.stack);
    const { x, y, z, age } = entry ?? {};
    if (!stack || ![x, y, z].every((n) => typeof n === 'number' && Number.isFinite(n))) return [];
    const at = { x: x as number, y: y as number, z: z as number };
    const spawnedAt = now - (typeof age === 'number' && age > 0 ? age : 0);
    return [{ id: i + 1, stack, start: { ...at, vx: 0, vy: 0, vz: 0 }, ...at, spawnedAt, pickupAt: spawnedAt }];
  });
}

function newWorld(conversationId: string, grid: BlockGrid, furnaces: Furnace[], chests: Chest[], items: DroppedItem[], clock: number, now: number): World {
  const chestMap = new Map(chests.map((chest) => [furnaceKey(chest.x, chest.y, chest.z), chest]));
  // a chest block whose contents were never stored (or were lost) starts empty
  for (let i = 0; i < grid.blocks.length; i++) {
    if (grid.blocks[i] !== BLOCK.chest) continue;
    const [x, y, z] = BlockGrid.cell(i);
    if (!chestMap.has(furnaceKey(x, y, z))) chestMap.set(furnaceKey(x, y, z), { x, y, z, slots: parseChest(null) });
  }
  return {
    conversationId, grid,
    furnaces: new Map(furnaces.map((furnace) => [furnaceKey(furnace.x, furnace.y, furnace.z), furnace])),
    chests: chestMap,
    items: new Map(items.map((item) => [item.id, item])),
    nextItemId: items.length + 1,
    dirtySince: null, version: 0, packed: null, emptySince: null, tickedAt: now, clock, clockShownAt: now,
  };
}

async function load(conversationId: string): Promise<World> {
  const now = Date.now();
  const stored = await store.load(conversationId);
  if (stored) {
    const grid = BlockGrid.from(stored.blocks, stored.states);
    // a world made before the creative chest gets it now
    const fixed = placeCreativeChest(grid);
    const world = newWorld(conversationId, grid, readFurnaces(stored.furnaces), readChests(stored.chests, grid), readItems(stored.items, now), readClock(stored.clock), now);
    if (fixed) world.dirtySince = now;
    return world;
  }
  const started = performance.now();
  const generated = generateWorld();
  const furnaces = generated.furnaces.map(({ x, y, z, facing }) => ({ x, y, z, facing, state: createFurnace(), lit: false, shownAt: 0 }));
  const world = newWorld(conversationId, generated.grid, furnaces, [], [], NEW_WORLD_TIME, now);
  log.info('world generated', { conversationId, ms: Math.round(performance.now() - started) });
  world.dirtySince = now;
  await save(world);
  return world;
}

/** The world of a playground, loaded (or made) on first need. */
export function worldFor(conversationId: string): Promise<World> {
  const known = worlds.get(conversationId);
  if (known) return Promise.resolve(known);
  let pending = loading.get(conversationId);
  if (!pending) {
    pending = load(conversationId)
      .then((world) => {
        worlds.set(conversationId, world);
        return world;
      })
      .finally(() => { loading.delete(conversationId); });
    loading.set(conversationId, pending);
  }
  return pending;
}

function snapshot(world: World, now: number) {
  return {
    generator: GENERATOR_VERSION,
    blocks: world.grid.blocks,
    states: world.grid.states,
    furnaces: [...world.furnaces.values()].map(({ x, y, z, facing, state }) => ({ x, y, z, facing, state })),
    chests: [...world.chests.values()].filter((chest) => chest.slots.some(Boolean)),
    items: [...world.items.values()].map((item) => ({ stack: item.stack, x: item.x, y: item.y, z: item.z, age: now - item.spawnedAt })),
    clock: world.clock,
  };
}

async function save(world: World): Promise<void> {
  if (world.dirtySince === null) return;
  const since = world.dirtySince;
  world.dirtySince = null;
  try {
    await store.save(world.conversationId, snapshot(world, Date.now()));
  } catch (err) {
    // tried again on the next tick
    world.dirtySince = world.dirtySince ?? since;
    log.warn('could not save a world', { conversationId: world.conversationId, err: err instanceof Error ? err.message : String(err) });
  }
}

function changed(world: World, now = Date.now()): void {
  if (world.dirtySince === null) world.dirtySince = now;
}

/** The blocks and their states as newcomers get them: deflated, made again only after a change. */
export function packedBlocks(world: World): { blocks: Buffer; states: Buffer } {
  if (world.packed?.version !== world.version) {
    world.packed = { version: world.version, blocks: deflateRawSync(world.grid.blocks), states: deflateRawSync(world.grid.states) };
  }
  return world.packed;
}

/** A block change as everyone hears it: the cell, the block and its state. */
export type BlockChange = [x: number, y: number, z: number, block: Block, state?: number];

export function itemView(item: DroppedItem, now: number) {
  return { id: item.id, item: item.stack.item, count: item.stack.count, start: item.start, age: Math.max(0, now - item.spawnedAt) };
}

export function furnaceLook(furnace: Furnace) {
  return { x: furnace.x, y: furnace.y, z: furnace.z, facing: furnace.facing, lit: furnace.lit };
}

/** Changes blocks and tells everyone in the call; items lying on a cell that changed fall again. */
export function setBlocks(world: World, changes: BlockChange[]): void {
  if (changes.length === 0) return;
  for (const [x, y, z, block, state] of changes) {
    world.grid.set(x, y, z, block, state);
    if (block !== BLOCK.furnace) world.furnaces.delete(furnaceKey(x, y, z));
    if (block !== BLOCK.chest) world.chests.delete(furnaceKey(x, y, z));
    else if (!world.chests.has(furnaceKey(x, y, z))) world.chests.set(furnaceKey(x, y, z), { x, y, z, slots: Array.from({ length: CHEST_SIZE }, () => null) });
  }
  world.version++;
  changed(world);
  // a state of 0 goes unsaid, as tabs from before states expect four numbers
  const told = changes.map(([x, y, z, block]): BlockChange => {
    const state = world.grid.stateAt(x, y, z);
    return state ? [x, y, z, block, state] : [x, y, z, block];
  });
  sendToCall(world.conversationId, { t: 'playground-blocks', conversationId: world.conversationId, changes: told });
  resettleItems(world, changes);
}

/** Items that rested on a cell now gone fall from where they are; items inside a cell now filled are
 * pushed up onto it. */
function resettleItems(world: World, changes: BlockChange[]): void {
  const moved: DroppedItem[] = [];
  const now = Date.now();
  for (const item of world.items.values()) {
    const bx = Math.floor(item.x);
    const bz = Math.floor(item.z);
    const below = Math.floor(item.y - 0.01);
    const inside = Math.floor(item.y + 0.01);
    for (const [x, y, z] of changes) {
      if (x !== bx || z !== bz || (y !== below && y !== inside)) continue;
      const startY = world.grid.isSolid(x, inside, z) ? inside + 1 : item.y;
      item.start = { x: item.x, y: startY, z: item.z, vx: 0, vy: 0, vz: 0 };
      Object.assign(item, restingPlace(world.grid, item.start));
      item.spawnedAt = now;
      moved.push(item);
      break;
    }
  }
  if (moved.length) sendToCall(world.conversationId, { t: 'playground-items', conversationId: world.conversationId, add: moved.map((item) => itemView(item, now)) });
}

/** Lays stacks on the ground from `start` (each with its own push), and tells everyone. */
export function spawnItems(world: World, drops: { stack: ItemStack; start: Motion }[], kind: keyof typeof PICKUP_DELAY_MS): void {
  if (drops.length === 0) return;
  const now = Date.now();
  const added: DroppedItem[] = [];
  for (const { stack, start } of drops) {
    if (stack.count <= 0) continue;
    const item: DroppedItem = { id: world.nextItemId++, stack, start, ...restingPlace(world.grid, start), spawnedAt: now, pickupAt: now + PICKUP_DELAY_MS[kind] };
    world.items.set(item.id, item);
    added.push(item);
  }
  const removed: number[] = [];
  for (const item of world.items.values()) {
    if (world.items.size - removed.length <= MAX_ITEMS) break;
    removed.push(item.id);
  }
  for (const id of removed) world.items.delete(id);
  changed(world);
  sendToCall(world.conversationId, {
    t: 'playground-items', conversationId: world.conversationId,
    add: added.filter((item) => world.items.has(item.id)).map((item) => itemView(item, now)),
    ...(removed.length ? { remove: removed } : {}),
  });
}

/** A start for a block's drop: from inside the broken cell, popped a little up and out. */
export function brokenStart(x: number, y: number, z: number, random: () => number = Math.random): Motion {
  return {
    x: x + 0.25 + random() * 0.5, y: y + 0.25 + random() * 0.5, z: z + 0.25 + random() * 0.5,
    vx: (random() - 0.5) * 0.2, vy: 0.2, vz: (random() - 0.5) * 0.2,
  };
}

/** Takes items off the ground (picked up, or partly: `left` of the stack stays); `by` names who took them. */
export function takeItems(world: World, taken: { id: number; left: number }[], by: string): void {
  if (taken.length === 0) return;
  const now = Date.now();
  const removed: number[] = [];
  const updated: DroppedItem[] = [];
  for (const { id, left } of taken) {
    const item = world.items.get(id);
    if (!item) continue;
    if (left > 0) {
      item.stack = { ...item.stack, count: left };
      updated.push(item);
    } else {
      world.items.delete(id);
      removed.push(id);
    }
  }
  changed(world);
  sendToCall(world.conversationId, {
    t: 'playground-items', conversationId: world.conversationId, by,
    ...(removed.length ? { remove: removed } : {}),
    ...(updated.length ? { add: updated.map((item) => itemView(item, now)) } : {}),
  });
}

export function addFurnace(world: World, x: number, y: number, z: number, facing: Facing): Furnace {
  const furnace: Furnace = { x, y, z, facing, state: createFurnace(), lit: false, shownAt: 0 };
  world.furnaces.set(furnaceKey(x, y, z), furnace);
  sendToCall(world.conversationId, { t: 'playground-furnace', conversationId: world.conversationId, ...furnaceLook(furnace) });
  return furnace;
}

export function furnaceAt(world: World, x: number, y: number, z: number): Furnace | null {
  return world.furnaces.get(furnaceKey(x, y, z)) ?? null;
}

export function chestAt(world: World, x: number, y: number, z: number): Chest | null {
  return world.chests.get(furnaceKey(x, y, z)) ?? null;
}

/** A chest's slots after a click into it: kept, and saved. */
export function updateChest(world: World, chest: Chest, slots: readonly Slot[]): void {
  chest.slots = [...slots];
  changed(world);
}

/** A furnace's state after a click into it: kept, and saved. */
export function updateFurnace(world: World, furnace: Furnace, state: FurnaceState): void {
  furnace.state = state;
  changed(world);
}

function setLit(world: World, furnace: Furnace, lit: boolean): void {
  if (furnace.lit === lit) return;
  furnace.lit = lit;
  sendToCall(world.conversationId, { t: 'playground-furnace', conversationId: world.conversationId, ...furnaceLook(furnace) });
}

/** Runs a world's game ticks up to `now`: furnaces burn and cook, old items vanish. Calls
 * `onFurnace` for each furnace whose viewers should hear about it. */
export function tickWorld(world: World, now: number, onFurnace: (furnace: Furnace) => void): void {
  const ticks = Math.min(MAX_CATCH_UP_TICKS, Math.floor((now - world.tickedAt) / TICK_MS));
  if (ticks <= 0) return;
  world.tickedAt += ticks * TICK_MS;
  if (now - world.tickedAt > TICK_MS * 4) world.tickedAt = now;
  world.clock = advanceClock(world.clock, ticks);
  if (now - world.clockShownAt >= CLOCK_REFRESH_MS) {
    world.clockShownAt = now;
    // the clock is saved with the world's next change, or when its last player leaves
    sendToCall(world.conversationId, { t: 'playground-time', conversationId: world.conversationId, clock: world.clock });
  }
  for (const furnace of world.furnaces.values()) {
    if (!furnaceActive(furnace.state) && furnace.state.cook === 0) continue;
    const slotsChanged = stepFurnace(furnace.state, ticks);
    changed(world, now);
    setLit(world, furnace, furnace.state.burn > 0);
    if (slotsChanged || now - furnace.shownAt >= FURNACE_REFRESH_MS) {
      furnace.shownAt = now;
      onFurnace(furnace);
    }
  }
  const expired: number[] = [];
  for (const item of world.items.values()) if (now - item.spawnedAt > DESPAWN_MS) expired.push(item.id);
  if (expired.length) {
    for (const id of expired) world.items.delete(id);
    changed(world, now);
    sendToCall(world.conversationId, { t: 'playground-items', conversationId: world.conversationId, remove: expired });
  }
}

/** Saves what is due and lets go of worlds nobody has been in for a while. `occupied` says whether a
 * playground has anyone in it now. */
export async function maintainWorlds(now: number, occupied: (conversationId: string) => boolean): Promise<void> {
  for (const world of [...worlds.values()]) {
    const empty = !occupied(world.conversationId);
    if (!empty) world.emptySince = null;
    else if (world.emptySince === null) {
      world.emptySince = now;
      changed(world, now);
      // its last player just left: saved now rather than later
      await save(world);
    }
    if (world.dirtySince !== null && now - world.dirtySince >= SAVE_AFTER_MS) await save(world);
    if (world.emptySince !== null && now - world.emptySince >= UNLOAD_AFTER_MS && world.dirtySince === null) worlds.delete(world.conversationId);
  }
}

/** Saves every world with changes (the service is stopping). */
export async function saveAllWorlds(): Promise<void> {
  await Promise.all([...worlds.values()].map((world) => save(world)));
}

/** Whether (x, y, z) is a cell of the world (for untrusted coordinates). */
export function isCell(x: unknown, y: unknown, z: unknown): boolean {
  return [x, y, z].every((n) => typeof n === 'number' && Number.isInteger(n)) && BlockGrid.inside(x as number, y as number, z as number);
}
