import { describe, expect, it } from 'vitest';
import {
  addItem, ARMOR_SLOTS, clickSlot, createInventory, heldStack, InventoryStore, OFFHAND_SLOT, putCursorBack, quickMove, scrollSelection,
  selectSlot, swapWithHotbar,
} from '@/features/playground/inventory/inventory';
import type { Inventory, Slot } from '@/features/playground/inventory/inventory';
import { itemDef, maxStackOf } from '@/features/playground/inventory/items';

const dirt = (count: number) => ({ item: 'dirt', count });
const stone = (count: number) => ({ item: 'stone', count });

function withSlots(slots: Record<number, Slot>, cursor: Slot = null): Inventory {
  const inventory = createInventory();
  const all = [...inventory.slots];
  for (const [index, slot] of Object.entries(slots)) all[Number(index)] = slot;
  return { ...inventory, slots: all, cursor };
}

describe('items', () => {
  it('knows the island\'s blocks, stacking to 64, and nothing else', () => {
    expect(itemDef('oak_planks')).toMatchObject({ name: 'items.oakPlanks', maxStack: 64, icon: { kind: 'block' } });
    expect(itemDef('diamond_sword')).toBeNull();
    expect(maxStackOf('diamond_sword')).toBe(1);
  });
});

describe('addItem', () => {
  it('fills matching stacks first, the hand\'s first, then the first empty slot of the hotbar', () => {
    const start = withSlots({ 3: dirt(60), 12: dirt(10) });
    const { inventory, left } = addItem({ ...start, selected: 3 }, dirt(20));
    expect(left).toBe(0);
    expect(inventory.slots[3]).toEqual(dirt(64));
    expect(inventory.slots[12]).toEqual(dirt(26));
    expect(addItem(createInventory(), stone(70)).inventory.slots.slice(0, 2)).toEqual([stone(64), stone(6)]);
  });

  it('says what did not fit', () => {
    const full = withSlots(Object.fromEntries(Array.from({ length: 36 }, (_, i) => [i, stone(64)])));
    expect(addItem(full, dirt(5)).left).toBe(5);
  });
});

describe('clickSlot', () => {
  it('picks up a whole stack with the left button, the larger half with the right', () => {
    expect(clickSlot(withSlots({ 0: dirt(7) }), 0, 'left')).toMatchObject({ cursor: dirt(7), slots: expect.arrayContaining([null]) });
    const half = clickSlot(withSlots({ 0: dirt(7) }), 0, 'right');
    expect(half.cursor).toEqual(dirt(4));
    expect(half.slots[0]).toEqual(dirt(3));
  });

  it('puts down all or one, merging up to a full stack', () => {
    expect(clickSlot(withSlots({}, dirt(5)), 9, 'left')).toMatchObject({ cursor: null });
    const one = clickSlot(withSlots({ 9: dirt(2) }, dirt(5)), 9, 'right');
    expect(one.slots[9]).toEqual(dirt(3));
    expect(one.cursor).toEqual(dirt(4));
    const merged = clickSlot(withSlots({ 9: dirt(60) }, dirt(10)), 9, 'left');
    expect(merged.slots[9]).toEqual(dirt(64));
    expect(merged.cursor).toEqual(dirt(6));
  });

  it('swaps different items, and keeps anything out of the armour slots', () => {
    const swapped = clickSlot(withSlots({ 9: stone(1) }, dirt(5)), 9, 'left');
    expect(swapped.slots[9]).toEqual(dirt(5));
    expect(swapped.cursor).toEqual(stone(1));
    const refused = withSlots({}, dirt(5));
    expect(clickSlot(refused, ARMOR_SLOTS[0], 'left')).toBe(refused);
    expect(clickSlot(refused, OFFHAND_SLOT, 'left').slots[OFFHAND_SLOT]).toEqual(dirt(5));
  });
});

describe('quickMove and swapWithHotbar', () => {
  it('moves a hotbar stack inside and an inside stack to the hotbar, merging first', () => {
    const fromHotbar = quickMove(withSlots({ 0: dirt(10), 20: dirt(60) }), 0);
    expect(fromHotbar.slots[20]).toEqual(dirt(64));
    expect(fromHotbar.slots[9]).toEqual(dirt(6));
    expect(fromHotbar.slots[0]).toBeNull();
    const fromInside = quickMove(withSlots({ 15: stone(3) }), 15);
    expect(fromInside.slots[0]).toEqual(stone(3));
  });

  it('trades a slot with a hotbar slot', () => {
    const swapped = swapWithHotbar(withSlots({ 20: dirt(1), 2: stone(2) }), 20, 2);
    expect(swapped.slots[20]).toEqual(stone(2));
    expect(swapped.slots[2]).toEqual(dirt(1));
  });
});

describe('selection', () => {
  it('selects a hotbar slot and wraps around with the wheel', () => {
    const inventory = withSlots({ 8: dirt(1) });
    expect(selectSlot(inventory, 8).selected).toBe(8);
    expect(selectSlot(inventory, 9)).toBe(inventory);
    expect(scrollSelection(inventory, -1).selected).toBe(8);
    expect(scrollSelection(selectSlot(inventory, 8), 1).selected).toBe(0);
    expect(heldStack(selectSlot(inventory, 8))).toEqual(dirt(1));
  });
});

describe('putCursorBack and the store', () => {
  it('puts the carried stack back when the screen closes', () => {
    expect(putCursorBack(withSlots({}, dirt(3)))).toMatchObject({ cursor: null, slots: expect.arrayContaining([dirt(3)]) });
  });

  it('tells its listeners only about real changes', () => {
    const store = new InventoryStore();
    let calls = 0;
    store.subscribe(() => { calls++; });
    store.update((inventory) => selectSlot(inventory, 0));
    store.update((inventory) => selectSlot(inventory, 4));
    expect(calls).toBe(1);
    expect(store.get().selected).toBe(4);
  });
});
