import { useSyncExternalStore } from 'react';
import { maxStackOf } from './items';

// The player's inventory, the block game's way: 9 hotbar slots (one selected,
// what the hand holds), 27 more inside, 4 for armour and one for the off hand,
// plus the stack the mouse carries while the inventory screen is open. Every
// change is a pure function returning a new inventory (what the screen and the
// HUD render), with the game's clicks: a left click picks up, puts down, merges
// or swaps a whole stack; a right click takes half or puts down one; a
// shift-click moves a stack between the hotbar and the rest.
//
// It lives with the playground session in this browser only, empty at first;
// once items can be picked up or used, the server will have to keep it.

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
}

export type Slot = ItemStack | null;

export interface Inventory {
  slots: readonly Slot[];
  /** the hotbar slot in hand, 0..8 */
  selected: number;
  /** what the mouse carries on the inventory screen */
  cursor: Slot;
}

export function createInventory(): Inventory {
  return { slots: Array.from({ length: SLOT_COUNT }, () => null), selected: 0, cursor: null };
}

/** Whether `index` may hold `stack`. Armour slots wait for armour. */
function accepts(index: number, stack: ItemStack): boolean {
  if (index < 0 || index >= SLOT_COUNT) return false;
  if ((ARMOR_SLOTS as readonly number[]).includes(index)) return false;
  return stack.count > 0;
}

const stack = (item: string, count: number): Slot => (count > 0 ? { item, count } : null);

function setSlots(inventory: Inventory, changes: [number, Slot][], cursor: Slot = inventory.cursor): Inventory {
  const slots = [...inventory.slots];
  for (const [index, slot] of changes) slots[index] = slot;
  return { ...inventory, slots, cursor };
}

/** Puts as much of `given` as fits into `order`'s slots (changing `slots`): first onto stacks of the
 * same item, then into empty slots. Returns how many did not fit. */
function store(slots: Slot[], given: ItemStack, order: readonly number[], emptyOrder: readonly number[] = order): number {
  let left = given.count;
  const max = maxStackOf(given.item);
  for (const index of order) {
    const slot = slots[index];
    if (left <= 0) break;
    if (!slot || slot.item !== given.item || slot.count >= max) continue;
    const moved = Math.min(left, max - slot.count);
    slots[index] = { item: slot.item, count: slot.count + moved };
    left -= moved;
  }
  for (const index of emptyOrder) {
    if (left <= 0) break;
    if (slots[index] || !accepts(index, given)) continue;
    const moved = Math.min(left, max);
    slots[index] = { item: given.item, count: moved };
    left -= moved;
  }
  return left;
}

const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i);
const HOTBAR_FIRST = range(0, STORAGE_END);
const INSIDE = range(HOTBAR_SIZE, STORAGE_END);
const HOTBAR = range(0, HOTBAR_SIZE);

/** Picks up `given`, the game's way: onto matching stacks (the hand's and the off hand's first), then the
 * first empty slot, the hotbar before the inside. `left` is what did not fit. */
export function addItem(inventory: Inventory, given: ItemStack): { inventory: Inventory; left: number } {
  const slots = [...inventory.slots];
  const order = [inventory.selected, OFFHAND_SLOT, ...HOTBAR_FIRST.filter((index) => index !== inventory.selected)];
  const left = store(slots, given, order, HOTBAR_FIRST);
  return { inventory: { ...inventory, slots }, left };
}

/** A click on a slot of the inventory screen, with the left or the right button. */
export function clickSlot(inventory: Inventory, index: number, button: 'left' | 'right'): Inventory {
  if (index < 0 || index >= SLOT_COUNT) return inventory;
  const slot = inventory.slots[index] ?? null;
  const { cursor } = inventory;
  if (!cursor) {
    if (!slot) return inventory;
    // a right click takes the larger half
    const taken = button === 'left' ? slot.count : Math.ceil(slot.count / 2);
    return setSlots(inventory, [[index, stack(slot.item, slot.count - taken)]], stack(slot.item, taken));
  }
  if (!accepts(index, cursor)) return inventory;
  const max = maxStackOf(cursor.item);
  if (!slot || slot.item === cursor.item) {
    const room = max - (slot?.count ?? 0);
    const moved = Math.min(button === 'left' ? cursor.count : 1, room);
    if (moved <= 0) return inventory;
    return setSlots(inventory, [[index, stack(cursor.item, (slot?.count ?? 0) + moved)]], stack(cursor.item, cursor.count - moved));
  }
  // different items trade places
  return setSlots(inventory, [[index, cursor]], slot);
}

/** A shift-click: the stack moves from the hotbar inside, or from inside (or armour, off hand) to the
 * hotbar, onto matching stacks first. What does not fit stays. */
export function quickMove(inventory: Inventory, index: number): Inventory {
  const slot = inventory.slots[index];
  if (!slot) return inventory;
  const slots = [...inventory.slots];
  slots[index] = null;
  const order = index < HOTBAR_SIZE ? INSIDE : index < STORAGE_END ? HOTBAR : [...INSIDE, ...HOTBAR];
  const left = store(slots, slot, order);
  slots[index] = stack(slot.item, left);
  return { ...inventory, slots };
}

/** A number key over a slot: it trades places with that hotbar slot. */
export function swapWithHotbar(inventory: Inventory, index: number, hotbar: number): Inventory {
  if (hotbar < 0 || hotbar >= HOTBAR_SIZE || index === hotbar) return inventory;
  const slot = inventory.slots[index] ?? null;
  const held = inventory.slots[hotbar] ?? null;
  if ((held && !accepts(index, held)) || (slot && !accepts(hotbar, slot))) return inventory;
  return setSlots(inventory, [[index, held], [hotbar, slot]]);
}

export function selectSlot(inventory: Inventory, selected: number): Inventory {
  if (!Number.isInteger(selected) || selected < 0 || selected >= HOTBAR_SIZE || selected === inventory.selected) return inventory;
  return { ...inventory, selected };
}

/** The wheel: down moves right, wrapping around the hotbar. */
export function scrollSelection(inventory: Inventory, steps: number): Inventory {
  return selectSlot(inventory, (((inventory.selected + steps) % HOTBAR_SIZE) + HOTBAR_SIZE) % HOTBAR_SIZE);
}

/** Closing the screen puts the carried stack back where it fits (the game would drop it; there is no
 * ground to drop it on yet). What does not fit stays carried. */
export function putCursorBack(inventory: Inventory): Inventory {
  if (!inventory.cursor) return inventory;
  const { inventory: next, left } = addItem({ ...inventory, cursor: null }, inventory.cursor);
  return { ...next, cursor: stack(inventory.cursor.item, left) };
}

/** What the hand holds. */
export function heldStack(inventory: Inventory): Slot {
  return inventory.slots[inventory.selected] ?? null;
}

export class InventoryStore {
  private value = createInventory();
  private readonly listeners = new Set<() => void>();

  get = (): Inventory => this.value;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  update(change: (inventory: Inventory) => Inventory): void {
    const next = change(this.value);
    if (next === this.value) return;
    this.value = next;
    for (const listener of this.listeners) listener();
  }
}

const EMPTY = createInventory();
const noSubscription = () => () => {};
const empty = () => EMPTY;

export function useInventory(store: InventoryStore | null): Inventory {
  return useSyncExternalStore(store?.subscribe ?? noSubscription, store?.get ?? empty);
}
