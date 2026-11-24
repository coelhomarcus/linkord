import {
  addItem, allStacks, applyOp, createInventory, emptied, heldStack, parseInventory,
  type Inventory, type InventoryOp, type ItemStack, type OpResult, type Window,
} from './game/inventory.js';
import type { Motion } from './game/drops.js';
import { memoryInventoryStore, type InventoryStore } from './worldStore.js';
import { isCurrent, playersIn, send, sendToCall, type Player } from './roster.js';
import { furnaceAt, loadedWorld, spawnItems, updateFurnace, type Furnace, type World } from './worlds.js';
import { logger } from './logger.js';

const log = logger.child({ component: 'inventories' });

// What each account carries in each playground, kept here (the browser only
// shows it, and shows a click's result before this confirms it). It is read
// when the account's first connection arrives, saved a moment after it
// changes, and goes with its owner's death (dropped where they fell).
//
// Every request that may change it carries the client's own running number
// (`seq`); each answer (`playground-inv`) says the last one handled (`ack`),
// so the client drops what it predicted up to there and keeps showing the rest
// on top of what this says.

const SAVE_AFTER_MS = 2000;

export interface Holder {
  conversationId: string;
  userId: string;
  inventory: Inventory;
  saveTimer: ReturnType<typeof setTimeout> | null;
  dirty: boolean;
}

const holders = new Map<string, Holder>();
const loading = new Map<string, Promise<Holder>>();
/** the last request number each connection sent */
const acks = new Map<string, number>();
/** what each connection's hand was last said to hold */
const shownHeld = new Map<string, string | null>();
let store: InventoryStore = memoryInventoryStore();

const keyOf = (conversationId: string, userId: string) => `${conversationId}:${userId}`;

/** index.ts hands in the database; tests keep the memory one, and start over with a fresh one. */
export function setInventoryStore(next: InventoryStore): void {
  store = next;
  for (const holder of holders.values()) if (holder.saveTimer) clearTimeout(holder.saveTimer);
  holders.clear();
  loading.clear();
  acks.clear();
  shownHeld.clear();
}

/** The account's inventory in the player's playground, read on first need. A failed read is an empty
 * inventory that is not saved over the stored one; it is read again on the next connection. */
export function inventoryOf(player: Player): Promise<Holder> {
  const key = keyOf(player.conversationId, player.userId);
  const known = holders.get(key);
  if (known) return Promise.resolve(known);
  let pending = loading.get(key);
  if (!pending) {
    pending = store.load(player.conversationId, player.userId)
      .then((stored) => {
        const holder: Holder = { conversationId: player.conversationId, userId: player.userId, inventory: parseInventory(stored) ?? createInventory(), saveTimer: null, dirty: false };
        holders.set(key, holder);
        return holder;
      })
      .catch((err: unknown) => {
        log.warn('could not read an inventory', { conversationId: player.conversationId, err: err instanceof Error ? err.message : String(err) });
        return { conversationId: player.conversationId, userId: player.userId, inventory: createInventory(), saveTimer: null, dirty: false };
      })
      .finally(() => { loading.delete(key); });
    loading.set(key, pending);
  }
  return pending;
}

function loadedHolder(player: Player): Holder | null {
  return holders.get(keyOf(player.conversationId, player.userId)) ?? null;
}

/** What the player's hand holds now (null before its inventory is read). */
export function heldItemOf(player: Player): string | null {
  const holder = loadedHolder(player);
  return holder ? heldStack(holder.inventory)?.item ?? null : null;
}

async function save(holder: Holder): Promise<void> {
  if (holder.saveTimer) clearTimeout(holder.saveTimer);
  holder.saveTimer = null;
  if (!holder.dirty) return;
  holder.dirty = false;
  // the grid and the carried stack are only in hand while a screen is open: saved as if put back
  const { slots, selected } = holder.inventory;
  try {
    await store.save(holder.conversationId, holder.userId, { slots, selected });
  } catch (err) {
    holder.dirty = true;
    log.warn('could not save an inventory', { conversationId: holder.conversationId, err: err instanceof Error ? err.message : String(err) });
    holder.saveTimer = setTimeout(() => void save(holder), SAVE_AFTER_MS * 5).unref();
  }
}

/** Keeps a changed inventory, saves it soon, and tells the call when a hand changed what it holds. */
export function setInventory(holder: Holder, inventory: Inventory): void {
  if (inventory === holder.inventory) return;
  holder.inventory = inventory;
  holder.dirty = true;
  if (!holder.saveTimer) holder.saveTimer = setTimeout(() => void save(holder), SAVE_AFTER_MS).unref();
  announceHeld(holder);
}

function announceHeld(holder: Holder): void {
  const item = heldStack(holder.inventory)?.item ?? null;
  const changes: { id: string; item: string | null }[] = [];
  for (const player of playersIn(holder.conversationId)) {
    if (player.userId !== holder.userId || shownHeld.get(player.id) === item) continue;
    shownHeld.set(player.id, item);
    changes.push({ id: player.id, item });
  }
  if (changes.length) sendToCall(holder.conversationId, { t: 'playground-held', conversationId: holder.conversationId, players: changes });
}

/** What everyone connected in a playground holds (for someone arriving). */
export function heldInCall(conversationId: string): { id: string; item: string | null }[] {
  const found: { id: string; item: string | null }[] = [];
  for (const player of playersIn(conversationId)) {
    const item = heldItemOf(player);
    shownHeld.set(player.id, item);
    found.push({ id: player.id, item });
  }
  return found;
}

/** The furnace a holder has open, if it still stands. */
function openFurnace(holder: Holder): { world: World; furnace: Furnace } | null {
  const open = holder.inventory.open;
  const world = loadedWorld(holder.conversationId);
  if (open?.kind !== 'furnace' || !world) return null;
  const furnace = furnaceAt(world, open.x, open.y, open.z);
  return furnace ? { world, furnace } : null;
}

function windowOf(holder: Holder): Window {
  return { inventory: holder.inventory, furnace: openFurnace(holder)?.furnace.state ?? null };
}

/** Records the last request the connection sent. */
export function acknowledge(player: Player, seq: unknown): void {
  if (typeof seq === 'number' && Number.isInteger(seq) && seq > (acks.get(player.id) ?? 0)) acks.set(player.id, seq);
}

/** Tells a connection what its account carries now, with what is in the furnace it has open. */
export function sendInventory(player: Player): void {
  const holder = loadedHolder(player);
  if (!holder || !isCurrent(player)) return;
  const { slots, selected, cursor, grid, open } = holder.inventory;
  const furnace = openFurnace(holder)?.furnace.state;
  send(player, {
    t: 'playground-inv', conversationId: player.conversationId, ack: acks.get(player.id) ?? 0,
    inventory: { slots, selected, cursor, grid, open }, ...(furnace ? { furnace } : {}),
  });
}

/** Sends every connection that has `furnace` open what is in it now (`except` is told separately). */
export function showFurnace(conversationId: string, furnace: { x: number; y: number; z: number }, except?: Player): void {
  for (const player of playersIn(conversationId)) {
    if (player === except) continue;
    const open = loadedHolder(player)?.inventory.open;
    if (open?.kind === 'furnace' && open.x === furnace.x && open.y === furnace.y && open.z === furnace.z) sendInventory(player);
  }
}

/** Where a stack thrown by someone standing at `at`, looking along `yaw`, starts. */
function thrownStart(at: { x: number; y: number; z: number; yaw: number }): Motion {
  return { x: at.x, y: at.y + 1.32, z: at.z, vx: Math.sin(at.yaw) * 0.3, vy: 0.1, vz: Math.cos(at.yaw) * 0.3 };
}

/** Applies a click (or any other operation) to the player's inventory and, through it, to the furnace it
 * has open. What it throws lands in front of `at`. */
export function applyInventoryOp(holder: Holder, player: Player, op: InventoryOp, at: { x: number; y: number; z: number; yaw: number } | null): OpResult {
  const before = windowOf(holder);
  const result = applyOp(before, op);
  const opened = openFurnace(holder);
  setInventory(holder, result.window.inventory);
  if (opened && result.window.furnace && result.window.furnace !== before.furnace) {
    updateFurnace(opened.world, opened.furnace, result.window.furnace);
    showFurnace(holder.conversationId, opened.furnace, player);
  }
  throwStacks(holder.conversationId, result.dropped, at);
  return result;
}

/** Throws stacks in front of `at` (nowhere, without a place to throw them from: they are lost). */
export function throwStacks(conversationId: string, stacks: ItemStack[], at: { x: number; y: number; z: number; yaw: number } | null): void {
  const world = loadedWorld(conversationId);
  if (!world || !at || stacks.length === 0) return;
  spawnItems(world, stacks.map((stack) => ({ stack, start: thrownStart(at) })), 'thrown');
}

/** Picks up stacks: what fits goes into the inventory; returns how many of each did not fit. */
export function pickUp(holder: Holder, stacks: ItemStack[]): number[] {
  let inventory = holder.inventory;
  const left = stacks.map((stack) => {
    const added = addItem(inventory, stack);
    inventory = added.inventory;
    return added.left;
  });
  setInventory(holder, inventory);
  return left;
}

/** A death: everything the player carried falls where it stood, scattered a little. */
export function dropEverything(player: Player, at: { x: number; y: number; z: number }, random: () => number = Math.random): void {
  const holder = loadedHolder(player);
  const world = loadedWorld(player.conversationId);
  if (!holder || !world) return;
  const stacks = allStacks(holder.inventory);
  if (stacks.length === 0) return;
  setInventory(holder, emptied(holder.inventory));
  for (const connection of playersIn(player.conversationId)) if (connection.userId === player.userId) sendInventory(connection);
  spawnItems(world, stacks.map((stack) => {
    const angle = random() * Math.PI * 2;
    const push = random() * 0.1;
    return { stack, start: { x: at.x, y: at.y + 1, z: at.z, vx: Math.cos(angle) * push, vy: 0.2, vz: Math.sin(angle) * push } };
  }), 'thrown');
}

/** A connection left: its numbers go; when it was the account's last one in the call, an open screen is
 * put away (what does not fit is thrown where it stood) and the inventory is saved and let go. */
export async function connectionLeft(player: Player, at: { x: number; y: number; z: number; yaw: number } | null): Promise<void> {
  acks.delete(player.id);
  shownHeld.delete(player.id);
  for (const other of playersIn(player.conversationId)) if (other.userId === player.userId) return;
  const holder = loadedHolder(player);
  if (!holder) return;
  if (holder.inventory.open || holder.inventory.cursor || holder.inventory.grid.some(Boolean)) applyInventoryOp(holder, player, { op: 'close' }, at);
  await save(holder);
  if (!playersInclude(player.conversationId, player.userId)) holders.delete(keyOf(player.conversationId, player.userId));
}

function playersInclude(conversationId: string, userId: string): boolean {
  for (const other of playersIn(conversationId)) if (other.userId === userId) return true;
  return false;
}

/** Every holder in a playground with `open` at that block (a crafting table or furnace being broken). */
export function holdersLookingAt(conversationId: string, x: number, y: number, z: number): Holder[] {
  return [...holders.values()].filter((holder) => holder.conversationId === conversationId && holder.inventory.open?.x === x && holder.inventory.open.y === y && holder.inventory.open.z === z);
}

export async function saveAllInventories(): Promise<void> {
  await Promise.all([...holders.values()].map((holder) => save(holder)));
}

/** Drops what deleted accounts carried, here and in the store. */
export async function forgetInventories(userIds: string[]): Promise<void> {
  const gone = new Set(userIds);
  for (const [key, holder] of holders) {
    if (!gone.has(holder.userId)) continue;
    if (holder.saveTimer) clearTimeout(holder.saveTimer);
    holders.delete(key);
  }
  await store.forget(userIds);
}
