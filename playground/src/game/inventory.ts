import { isBlock } from './blocks.js';
import { itemDef, maxStackOf } from './items.js';
import { matchRecipe } from './recipes.js';
import { createFurnace, FURNACE_FUEL, FURNACE_INPUT, FURNACE_OUTPUT, fuelTicks, smeltResult, type FurnaceState } from './smelting.js';

// A player's inventory and the screens that open over it, the block game's
// way: 9 hotbar slots (one selected, what the hand holds), 27 more inside, 4
// for armour and one for the off hand; the stack the mouse carries; a crafting
// grid (the inventory's own 2×2, or a crafting table's 3×3) with its result;
// and a furnace's three slots while one is open. Every change is an operation
// (`applyOp`), a pure function of the state, so the playground service, which
// keeps every inventory, and the browser, which shows the result of a click at
// once, run the very same rules. The clicks are the game's: a left click picks
// up, puts down, merges or swaps a whole stack; a right click takes half or
// puts down one; a shift-click moves a stack to where it belongs; a number key
// swaps with that hotbar slot.

export const HOTBAR_SIZE = 9;
/** the hotbar's slots, then the inside's */
const STORAGE_END = 36;
/** head, chest, legs, feet: no item fits there yet */
export const ARMOR_SLOTS = [36, 37, 38, 39] as const;
export const OFFHAND_SLOT = 40;
const SLOT_COUNT = 41;

export interface ItemStack {
  item: string;
  count: number;
  /** a tool's wear, 0 while new */
  damage?: number;
}

export type Slot = ItemStack | null;

/** A crafting table or a furnace open over the inventory, by where it stands. */
export interface OpenContainer { kind: 'table' | 'furnace'; x: number; y: number; z: number }

export interface Inventory {
  slots: readonly Slot[];
  /** the hotbar slot in hand, 0..8 */
  selected: number;
  /** what the mouse carries on an open screen */
  cursor: Slot;
  /** the open screen's crafting grid: 4 cells (the inventory's 2×2) or 9 (a crafting table's) */
  grid: readonly Slot[];
  open: OpenContainer | null;
}

/** Where a click lands. */
export type SlotRef =
  | { area: 'inv'; index: number }
  | { area: 'grid'; index: number }
  | { area: 'result' }
  | { area: 'furnace'; index: number };

export type InventoryOp =
  | { op: 'click'; slot: SlotRef; button: 'left' | 'right'; shift: boolean }
  /** a number key over a slot */
  | { op: 'swap'; slot: SlotRef; hotbar: number }
  /** a click outside the screen: the carried stack (or one of it) is thrown */
  | { op: 'drop-cursor'; all: boolean }
  /** Q: one of what the hand holds is thrown, or all of it */
  | { op: 'drop-held'; all: boolean }
  | { op: 'select'; slot: number }
  /** the screen closes: the grid and the carried stack go back to the inventory */
  | { op: 'close' };

/** The inventory and, while one is open, the furnace it looks into. */
export interface Window {
  inventory: Inventory;
  furnace: FurnaceState | null;
}

export interface OpResult {
  window: Window;
  /** what was thrown to the ground (or did not fit back) */
  dropped: ItemStack[];
}

const GRID_2X2 = 4;
const GRID_3X3 = 9;

export function createInventory(): Inventory {
  return { slots: Array.from({ length: SLOT_COUNT }, () => null), selected: 0, cursor: null, grid: Array.from({ length: GRID_2X2 }, () => null), open: null };
}

const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i);
const HOTBAR = range(0, HOTBAR_SIZE);
const INSIDE = range(HOTBAR_SIZE, STORAGE_END);
const HOTBAR_FIRST = range(0, STORAGE_END);

const stackOf = (like: ItemStack, count: number): Slot => (count > 0 ? { ...like, count } : null);
/** Whether two stacks may merge: the same item, equally worn. */
const sameKind = (a: ItemStack, b: ItemStack): boolean => a.item === b.item && (a.damage ?? 0) === (b.damage ?? 0);

/** Whether inventory slot `index` may hold `stack`. Armour slots wait for armour. */
function invAccepts(index: number, stack: ItemStack): boolean {
  if (index < 0 || index >= SLOT_COUNT) return false;
  if ((ARMOR_SLOTS as readonly number[]).includes(index)) return false;
  return stack.count > 0;
}

/** Puts as much of `given` as fits into `order`'s slots (changing `slots`): first onto stacks of the same
 * item, then into empty slots. Returns how many did not fit. */
function store(slots: Slot[], given: ItemStack, order: readonly number[], emptyOrder: readonly number[] = order): number {
  let left = given.count;
  const max = maxStackOf(given.item);
  for (const index of order) {
    if (left <= 0) break;
    const slot = slots[index];
    if (!slot || !sameKind(slot, given) || slot.count >= max) continue;
    const moved = Math.min(left, max - slot.count);
    slots[index] = { ...slot, count: slot.count + moved };
    left -= moved;
  }
  for (const index of emptyOrder) {
    if (left <= 0) break;
    if (slots[index] || !invAccepts(index, given)) continue;
    const moved = Math.min(left, max);
    slots[index] = { ...given, count: moved };
    left -= moved;
  }
  return left;
}

/** Picks up `given`, the game's way: onto matching stacks (the hand's and the off hand's first), then the
 * first empty slot, the hotbar before the inside. `left` is what did not fit. */
export function addItem(inventory: Inventory, given: ItemStack): { inventory: Inventory; left: number } {
  const slots = [...inventory.slots];
  const order = [inventory.selected, OFFHAND_SLOT, ...HOTBAR_FIRST.filter((index) => index !== inventory.selected)];
  const left = store(slots, given, order, HOTBAR_FIRST);
  return { inventory: { ...inventory, slots }, left };
}

/** What the hand holds. */
export function heldStack(inventory: Inventory): Slot {
  return inventory.slots[inventory.selected] ?? null;
}

/** The held stack less `count` (a block placed). */
export function useHeld(inventory: Inventory, count = 1): Inventory {
  const held = heldStack(inventory);
  if (!held) return inventory;
  const slots = [...inventory.slots];
  slots[inventory.selected] = stackOf(held, held.count - count);
  return { ...inventory, slots };
}

/** Wears the held tool by `amount`; one worn through breaks and is gone. */
export function wearHeld(inventory: Inventory, amount: number): Inventory {
  const held = heldStack(inventory);
  const durability = held ? itemDef(held.item)?.tool?.durability : undefined;
  if (!held || !durability || amount <= 0) return inventory;
  const damage = (held.damage ?? 0) + amount;
  const slots = [...inventory.slots];
  slots[inventory.selected] = damage >= durability ? null : { ...held, damage };
  return { ...inventory, slots };
}

/** Everything the inventory holds, the carried stack and the grid included (what a death drops). */
export function allStacks(inventory: Inventory): ItemStack[] {
  return [...inventory.slots, inventory.cursor, ...inventory.grid].filter((slot): slot is ItemStack => !!slot);
}

/** The same inventory, emptied (after a death). */
export function emptied(inventory: Inventory): Inventory {
  return { ...createInventory(), selected: inventory.selected, open: inventory.open, grid: inventory.grid.map(() => null) };
}

/** What the open grid makes, or null. */
export function craftingResult(inventory: Inventory): ItemStack | null {
  const result = matchRecipe(inventory.grid, inventory.grid.length === GRID_3X3 ? 3 : 2);
  return result ? { item: result.item, count: result.count } : null;
}

/** Opens a crafting table or a furnace over the inventory; what the screen had open is put away first. */
export function openContainer(inventory: Inventory, container: OpenContainer): OpResult {
  const closed = closeScreen(inventory);
  return {
    window: { inventory: { ...closed.inventory, open: container, grid: Array.from({ length: container.kind === 'table' ? GRID_3X3 : GRID_2X2 }, () => null) }, furnace: null },
    dropped: closed.dropped,
  };
}

/** Puts the grid and the carried stack back in the inventory, closing what was open; what does not fit is dropped. */
function closeScreen(inventory: Inventory): { inventory: Inventory; dropped: ItemStack[] } {
  let next: Inventory = { ...inventory, cursor: null, grid: Array.from({ length: GRID_2X2 }, () => null), open: null };
  const dropped: ItemStack[] = [];
  for (const stack of [inventory.cursor, ...inventory.grid]) {
    if (!stack) continue;
    const added = addItem(next, stack);
    next = added.inventory;
    if (added.left > 0) dropped.push({ ...stack, count: added.left });
  }
  return { inventory: next, dropped };
}

/** A sanitised inventory from stored or untrusted JSON; null when it is not one. */
export function parseInventory(value: unknown): Inventory | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.slots)) return null;
  const inventory = createInventory();
  const slots = inventory.slots.map((_, i) => parseStack(raw.slots instanceof Array ? raw.slots[i] : null));
  const selected = typeof raw.selected === 'number' && Number.isInteger(raw.selected) && raw.selected >= 0 && raw.selected < HOTBAR_SIZE ? raw.selected : 0;
  return { ...inventory, slots, selected };
}

export function parseStack(value: unknown): Slot {
  if (!value || typeof value !== 'object') return null;
  const { item, count, damage } = value as Record<string, unknown>;
  if (typeof item !== 'string' || !itemDef(item) || typeof count !== 'number' || !Number.isInteger(count) || count <= 0) return null;
  const stack: ItemStack = { item, count: Math.min(count, maxStackOf(item)) };
  const durability = itemDef(item)!.tool?.durability;
  if (durability && typeof damage === 'number' && Number.isInteger(damage) && damage > 0 && damage < durability) stack.damage = damage;
  return stack;
}

/** A sanitised furnace from stored JSON. */
export function parseFurnace(value: unknown): FurnaceState {
  const furnace = createFurnace();
  if (!value || typeof value !== 'object') return furnace;
  const raw = value as Record<string, unknown>;
  if (Array.isArray(raw.slots)) furnace.slots = [parseStack(raw.slots[0]), parseStack(raw.slots[1]), parseStack(raw.slots[2])];
  const ticks = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
  furnace.burn = ticks(raw.burn);
  furnace.burnTotal = Math.max(furnace.burn, ticks(raw.burnTotal));
  furnace.cook = ticks(raw.cook);
  return furnace;
}

// ---- clicks ----

/** A mutable copy of a window, changed in place by one operation. */
interface Draft {
  slots: Slot[];
  grid: Slot[];
  furnace: FurnaceState | null;
  cursor: Slot;
  inventory: Inventory;
  dropped: ItemStack[];
}

function getSlot(draft: Draft, ref: SlotRef): Slot {
  if (ref.area === 'inv') return draft.slots[ref.index] ?? null;
  if (ref.area === 'grid') return draft.grid[ref.index] ?? null;
  if (ref.area === 'furnace') return draft.furnace?.slots[ref.index] ?? null;
  return null;
}

function setSlot(draft: Draft, ref: SlotRef, slot: Slot): void {
  if (ref.area === 'inv') draft.slots[ref.index] = slot;
  else if (ref.area === 'grid') draft.grid[ref.index] = slot;
  else if (ref.area === 'furnace' && draft.furnace) draft.furnace.slots[ref.index as 0 | 1 | 2] = slot;
}

/** Whether a slot exists in this window and may take `stack` (null: whether it exists at all). */
function accepts(draft: Draft, ref: SlotRef, stack: ItemStack | null): boolean {
  if (ref.area === 'inv') return Number.isInteger(ref.index) && ref.index >= 0 && ref.index < SLOT_COUNT && (!stack || invAccepts(ref.index, stack));
  if (ref.area === 'grid') return Number.isInteger(ref.index) && ref.index >= 0 && ref.index < draft.grid.length;
  if (ref.area === 'furnace') {
    if (!draft.furnace || !Number.isInteger(ref.index) || ref.index < 0 || ref.index > 2) return false;
    if (!stack) return true;
    if (ref.index === FURNACE_OUTPUT) return false;
    return ref.index !== FURNACE_FUEL || fuelTicks(stack.item) > 0;
  }
  return false;
}

/** The game's click on an ordinary slot: pick up, put down, merge, or swap. */
function clickPlain(draft: Draft, ref: SlotRef, button: 'left' | 'right'): void {
  const slot = getSlot(draft, ref);
  const { cursor } = draft;
  if (!cursor) {
    if (!slot) return;
    // a right click takes the larger half
    const taken = button === 'left' ? slot.count : Math.ceil(slot.count / 2);
    setSlot(draft, ref, stackOf(slot, slot.count - taken));
    draft.cursor = stackOf(slot, taken);
    return;
  }
  if (!accepts(draft, ref, cursor)) {
    // a slot that takes nothing (a furnace's output) still gives: its stack onto the carried one
    if (slot && sameKind(slot, cursor) && cursor.count + slot.count <= maxStackOf(cursor.item)) {
      draft.cursor = stackOf(cursor, cursor.count + slot.count);
      setSlot(draft, ref, null);
    }
    return;
  }
  const max = maxStackOf(cursor.item);
  if (!slot || sameKind(slot, cursor)) {
    const room = max - (slot?.count ?? 0);
    const moved = Math.min(button === 'left' ? cursor.count : 1, room);
    if (moved <= 0) return;
    setSlot(draft, ref, stackOf(cursor, (slot?.count ?? 0) + moved));
    draft.cursor = stackOf(cursor, cursor.count - moved);
    return;
  }
  // different items trade places
  setSlot(draft, ref, cursor);
  draft.cursor = slot;
}

/** Uses up one of every filled grid cell (a craft taken). */
function consumeGrid(draft: Draft): void {
  for (let i = 0; i < draft.grid.length; i++) {
    const cell = draft.grid[i];
    if (cell) draft.grid[i] = stackOf(cell, cell.count - 1);
  }
}

const gridResult = (draft: Draft): ItemStack | null => {
  const result = matchRecipe(draft.grid, draft.grid.length === GRID_3X3 ? 3 : 2);
  return result ? { item: result.item, count: result.count } : null;
};

/** Takes the craft onto the carried stack, if it fits there. */
function takeResult(draft: Draft): void {
  const result = gridResult(draft);
  if (!result) return;
  const { cursor } = draft;
  if (cursor && (!sameKind(cursor, result) || cursor.count + result.count > maxStackOf(result.item))) return;
  draft.cursor = stackOf(result, (cursor?.count ?? 0) + result.count);
  consumeGrid(draft);
}

/** Shift on the result: crafts again and again into the inventory while the same thing comes out and fits. */
function takeAllResults(draft: Draft): void {
  const first = gridResult(draft);
  if (!first) return;
  const order = [...HOTBAR].reverse().concat([...INSIDE].reverse());
  for (let i = 0; i < 64; i++) {
    const result = gridResult(draft);
    if (!result || !sameKind(result, first)) return;
    const trial = [...draft.slots];
    if (store(trial, result, order) > 0) return;
    draft.slots = trial;
    consumeGrid(draft);
  }
}

/** Moves a stack into the `order` slots of the inventory; what does not fit stays where it was. */
function moveToInventory(draft: Draft, ref: SlotRef, order: readonly number[]): void {
  const slot = getSlot(draft, ref);
  if (!slot) return;
  const left = store(draft.slots, slot, order);
  setSlot(draft, ref, stackOf(slot, left));
}

/** Moves an inventory stack into a furnace slot (merging, or into an empty one); returns what is left. */
function moveIntoFurnace(draft: Draft, stack: ItemStack, index: number): number {
  const furnace = draft.furnace!;
  const there = furnace.slots[index];
  const max = maxStackOf(stack.item);
  if (there && !sameKind(there, stack)) return stack.count;
  const moved = Math.min(stack.count, max - (there?.count ?? 0));
  if (moved <= 0) return stack.count;
  furnace.slots[index as 0 | 1 | 2] = stackOf(stack, (there?.count ?? 0) + moved);
  return stack.count - moved;
}

/** A shift-click: the stack goes where the game sends it. */
function quickMoveRef(draft: Draft, ref: SlotRef): void {
  if (ref.area === 'result') return takeAllResults(draft);
  if (ref.area === 'grid' || ref.area === 'furnace') return moveToInventory(draft, ref, [...INSIDE, ...HOTBAR]);
  const slot = getSlot(draft, ref);
  if (!slot) return;
  const index = ref.index;
  if (draft.furnace && index < STORAGE_END) {
    const target = smeltResult(slot.item) ? FURNACE_INPUT : fuelTicks(slot.item) > 0 ? FURNACE_FUEL : null;
    if (target !== null) {
      const left = moveIntoFurnace(draft, slot, target);
      if (left !== slot.count) {
        setSlot(draft, ref, stackOf(slot, left));
        return;
      }
    }
  }
  draft.slots[index] = null;
  const order = index < HOTBAR_SIZE ? INSIDE : index < STORAGE_END ? HOTBAR : [...INSIDE, ...HOTBAR];
  const left = store(draft.slots, slot, order);
  draft.slots[index] = stackOf(slot, left);
}

function swapRef(draft: Draft, ref: SlotRef, hotbar: number): void {
  if (!Number.isInteger(hotbar) || hotbar < 0 || hotbar >= HOTBAR_SIZE) return;
  const held = draft.slots[hotbar] ?? null;
  if (ref.area === 'result') {
    // the game crafts straight into an empty hotbar slot
    const result = gridResult(draft);
    if (!result || held) return;
    draft.slots[hotbar] = result;
    consumeGrid(draft);
    return;
  }
  if (!accepts(draft, ref, null) || (ref.area === 'inv' && ref.index === hotbar)) return;
  const slot = getSlot(draft, ref);
  if ((held && !accepts(draft, ref, held)) || (slot && !invAccepts(hotbar, slot))) return;
  setSlot(draft, ref, held);
  draft.slots[hotbar] = slot;
}

function throwFrom(draft: Draft, stack: Slot, all: boolean): Slot {
  if (!stack) return null;
  const count = all ? stack.count : 1;
  draft.dropped.push({ ...stack, count });
  return stackOf(stack, stack.count - count);
}

/** Applies one operation to a window. An operation that makes no sense here (a slot that is not open)
 * changes nothing. */
export function applyOp(window: Window, op: InventoryOp): OpResult {
  const { inventory } = window;
  const draft: Draft = {
    slots: [...inventory.slots],
    grid: [...inventory.grid],
    furnace: window.furnace && inventory.open?.kind === 'furnace' ? { ...window.furnace, slots: [...window.furnace.slots] } : null,
    cursor: inventory.cursor,
    inventory,
    dropped: [],
  };
  switch (op.op) {
    case 'click':
      if (op.slot.area !== 'result' && !accepts(draft, op.slot, null)) break;
      if (op.slot.area === 'result' && inventory.open?.kind === 'furnace') break;
      if (op.shift && !draft.cursor) quickMoveRef(draft, op.slot);
      else if (op.slot.area === 'result') takeResult(draft);
      else clickPlain(draft, op.slot, op.button);
      break;
    case 'swap':
      if (draft.cursor) break;
      swapRef(draft, op.slot, op.hotbar);
      break;
    case 'drop-cursor':
      draft.cursor = throwFrom(draft, draft.cursor, op.all);
      break;
    case 'drop-held':
      draft.slots[inventory.selected] = throwFrom(draft, draft.slots[inventory.selected] ?? null, op.all);
      break;
    case 'select':
      if (Number.isInteger(op.slot) && op.slot >= 0 && op.slot < HOTBAR_SIZE) {
        return { window: { ...window, inventory: { ...inventory, selected: op.slot } }, dropped: [] };
      }
      return { window, dropped: [] };
    case 'close': {
      const closed = closeScreen(inventory);
      return { window: { inventory: closed.inventory, furnace: null }, dropped: closed.dropped };
    }
  }
  return {
    window: {
      inventory: { ...inventory, slots: draft.slots, grid: draft.grid, cursor: draft.cursor },
      furnace: draft.furnace ?? window.furnace,
    },
    dropped: draft.dropped,
  };
}

/** Whether a value is a slot reference this version knows (from an untrusted client). */
function readSlotRef(value: unknown): SlotRef | null {
  if (!value || typeof value !== 'object') return null;
  const { area, index } = value as Record<string, unknown>;
  if (area === 'result') return { area };
  if ((area === 'inv' || area === 'grid' || area === 'furnace') && typeof index === 'number' && Number.isInteger(index)) return { area, index };
  return null;
}

/** An operation from an untrusted client, or null. */
export function readOp(value: unknown): InventoryOp | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  switch (raw.op) {
    case 'click': {
      const slot = readSlotRef(raw.slot);
      if (!slot || (raw.button !== 'left' && raw.button !== 'right')) return null;
      return { op: 'click', slot, button: raw.button, shift: raw.shift === true };
    }
    case 'swap': {
      const slot = readSlotRef(raw.slot);
      return slot && typeof raw.hotbar === 'number' ? { op: 'swap', slot, hotbar: raw.hotbar } : null;
    }
    case 'drop-cursor': return { op: 'drop-cursor', all: raw.all !== false };
    case 'drop-held': return { op: 'drop-held', all: raw.all === true };
    case 'select': return typeof raw.slot === 'number' ? { op: 'select', slot: raw.slot } : null;
    case 'close': return { op: 'close' };
    default: return null;
  }
}

/** The block a held stack places, if any. */
export function heldBlock(inventory: Inventory): number | null {
  const held = heldStack(inventory);
  const places = held ? itemDef(held.item)?.places : undefined;
  return places !== undefined && isBlock(places) ? places : null;
}
