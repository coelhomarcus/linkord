import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  addItem, applyOp, ARMOR_SLOTS, createInventory, heldStack, OFFHAND_SLOT, openContainer, parseInventory, useHeld, wearHeld,
  type Inventory, type InventoryOp, type Slot, type SlotRef, type Window,
} from '../../src/game/inventory.js';
import { createFurnace, type FurnaceState } from '../../src/game/smelting.js';

const dirt = (count: number): Slot => ({ item: 'dirt', count });
const stone = (count: number): Slot => ({ item: 'stone', count });
const planks = (count: number): Slot => ({ item: 'oak_planks', count });

function withSlots(slots: Record<number, Slot>, cursor: Slot = null, extra: Partial<Inventory> = {}): Inventory {
  const inventory = createInventory();
  const all = [...inventory.slots];
  for (const [index, slot] of Object.entries(slots)) all[Number(index)] = slot;
  return { ...inventory, slots: all, cursor, ...extra };
}

const inv = (index: number): SlotRef => ({ area: 'inv', index });
const run = (inventory: Inventory, op: InventoryOp, furnace: FurnaceState | null = null) => applyOp({ inventory, furnace }, op);
const click = (inventory: Inventory, slot: SlotRef, button: 'left' | 'right' = 'left', shift = false) => run(inventory, { op: 'click', slot, button, shift }).window.inventory;

describe('addItem', () => {
  test('fills matching stacks first, the hand\'s first, then the first empty slot of the hotbar', () => {
    const start = withSlots({ 3: dirt(60), 12: dirt(10) });
    const { inventory, left } = addItem({ ...start, selected: 3 }, dirt(20)!);
    assert.equal(left, 0);
    assert.deepEqual(inventory.slots[3], dirt(64));
    assert.deepEqual(inventory.slots[12], dirt(26));
    assert.deepEqual(addItem(createInventory(), stone(70)!).inventory.slots.slice(0, 2), [stone(64), stone(6)]);
  });

  test('says what did not fit', () => {
    const full = withSlots(Object.fromEntries(Array.from({ length: 36 }, (_, i) => [i, stone(64)])));
    assert.equal(addItem(full, dirt(5)!).left, 5);
  });
});

describe('clicks', () => {
  test('pick up a whole stack with the left button, the larger half with the right', () => {
    assert.deepEqual(click(withSlots({ 0: dirt(7) }), inv(0)).cursor, dirt(7));
    const half = click(withSlots({ 0: dirt(7) }), inv(0), 'right');
    assert.deepEqual([half.cursor, half.slots[0]], [dirt(4), dirt(3)]);
  });

  test('put down all or one, merging up to a full stack, and swap different items', () => {
    assert.equal(click(withSlots({}, dirt(5)), inv(9)).cursor, null);
    const one = click(withSlots({ 9: dirt(2) }, dirt(5)), inv(9), 'right');
    assert.deepEqual([one.slots[9], one.cursor], [dirt(3), dirt(4)]);
    const merged = click(withSlots({ 9: dirt(60) }, dirt(10)), inv(9));
    assert.deepEqual([merged.slots[9], merged.cursor], [dirt(64), dirt(6)]);
    const swapped = click(withSlots({ 9: stone(1) }, dirt(5)), inv(9));
    assert.deepEqual([swapped.slots[9], swapped.cursor], [dirt(5), stone(1)]);
  });

  test('keep anything out of the armour slots, not the off hand', () => {
    const carrying = withSlots({}, dirt(5));
    assert.equal(click(carrying, inv(ARMOR_SLOTS[0])).cursor?.count, 5);
    assert.deepEqual(click(carrying, inv(OFFHAND_SLOT)).slots[OFFHAND_SLOT], dirt(5));
  });

  test('shift moves between the hotbar and the inside, merging first; a number key swaps', () => {
    const fromHotbar = click(withSlots({ 0: dirt(10), 20: dirt(60) }), inv(0), 'left', true);
    assert.deepEqual([fromHotbar.slots[20], fromHotbar.slots[9], fromHotbar.slots[0]], [dirt(64), dirt(6), null]);
    assert.deepEqual(click(withSlots({ 15: stone(3) }), inv(15), 'left', true).slots[0], stone(3));
    const swapped = run(withSlots({ 20: dirt(1), 2: stone(2) }), { op: 'swap', slot: inv(20), hotbar: 2 }).window.inventory;
    assert.deepEqual([swapped.slots[20], swapped.slots[2]], [stone(2), dirt(1)]);
  });

  test('select a hotbar slot; Q throws one held, or all', () => {
    const inventory = withSlots({ 4: dirt(3) });
    const selected = run(inventory, { op: 'select', slot: 4 }).window.inventory;
    assert.deepEqual(heldStack(selected), dirt(3));
    assert.equal(run(inventory, { op: 'select', slot: 9 }).window.inventory.selected, 0);
    const one = run(selected, { op: 'drop-held', all: false });
    assert.deepEqual([one.window.inventory.slots[4], one.dropped], [dirt(2), [dirt(1)]]);
    assert.deepEqual(run(selected, { op: 'drop-held', all: true }).dropped, [dirt(3)]);
  });
});

describe('crafting', () => {
  const grid = (cells: Slot[]) => ({ grid: cells });

  test('the result comes from the grid and uses one of each cell', () => {
    const start = withSlots({}, null, grid([{ item: 'oak_log', count: 2 }, null, null, null]));
    const taken = click(start, { area: 'result' });
    assert.deepEqual(taken.cursor, planks(4));
    assert.deepEqual(taken.grid[0], { item: 'oak_log', count: 1 });
    const again = click(taken, { area: 'result' });
    assert.deepEqual([again.cursor, again.grid[0]], [planks(8), null]);
    assert.deepEqual(click(again, { area: 'result' }), again);
  });

  test('shift on the result crafts all it can into the inventory', () => {
    const start = withSlots({}, null, grid([{ item: 'oak_log', count: 3 }, null, null, null]));
    const all = click(start, { area: 'result' }, 'left', true);
    assert.equal(all.grid[0], null);
    assert.equal(all.slots.filter(Boolean).reduce((n, slot) => n + slot!.count, 0), 12);
  });

  test('a crafting table opens a 3×3 grid; closing puts it all back', () => {
    const opened = openContainer(withSlots({ 0: stone(1) }), { kind: 'table', x: 1, y: 2, z: 3 }).window.inventory;
    assert.equal(opened.grid.length, 9);
    const filled = { ...opened, grid: opened.grid.map((cell, i) => (i < 3 ? { item: 'cobblestone', count: 1 } : cell)), cursor: dirt(2) };
    const closed = run(filled, { op: 'close' });
    assert.equal(closed.window.inventory.open, null);
    assert.equal(closed.window.inventory.grid.length, 4);
    assert.deepEqual(closed.window.inventory.slots.slice(0, 3), [stone(1), dirt(2), { item: 'cobblestone', count: 3 }]);
    assert.deepEqual(closed.dropped, []);
  });
});

describe('furnace', () => {
  const opened = (inventory: Inventory): Window => ({
    inventory: openContainer(inventory, { kind: 'furnace', x: 0, y: 0, z: 0 }).window.inventory,
    furnace: createFurnace(),
  });

  test('shift sends ore to the input and coal to the fuel', () => {
    const window = opened(withSlots({ 0: { item: 'iron_ore', count: 5 }, 1: { item: 'coal', count: 2 } }));
    const ore = applyOp(window, { op: 'click', slot: inv(0), button: 'left', shift: true }).window;
    const coal = applyOp(ore, { op: 'click', slot: inv(1), button: 'left', shift: true }).window;
    assert.deepEqual(coal.furnace?.slots, [{ item: 'iron_ore', count: 5 }, { item: 'coal', count: 2 }, null]);
    assert.equal(coal.inventory.slots[0], null);
  });

  test('takes nothing into the output, and only fuel into the fuel slot', () => {
    const window = opened(withSlots({}, dirt(3)));
    assert.equal(applyOp(window, { op: 'click', slot: { area: 'furnace', index: 2 }, button: 'left', shift: false }).window.furnace?.slots[2], null);
    assert.equal(applyOp(window, { op: 'click', slot: { area: 'furnace', index: 1 }, button: 'left', shift: false }).window.furnace?.slots[1], null);
    const output = { ...window, furnace: { ...createFurnace(), slots: [null, null, { item: 'iron_ingot', count: 4 }] as FurnaceState['slots'] } };
    const empty = { ...output, inventory: { ...output.inventory, cursor: null } };
    assert.deepEqual(applyOp(empty, { op: 'click', slot: { area: 'furnace', index: 2 }, button: 'left', shift: false }).window.inventory.cursor, { item: 'iron_ingot', count: 4 });
  });

  test('a furnace slot does nothing without a furnace open', () => {
    const window: Window = { inventory: withSlots({}, dirt(1)), furnace: null };
    assert.deepEqual(applyOp(window, { op: 'click', slot: { area: 'furnace', index: 0 }, button: 'left', shift: false }).window.inventory, window.inventory);
  });
});

describe('held items and storage', () => {
  test('placing uses one; a tool wears and breaks', () => {
    assert.deepEqual(useHeld(withSlots({ 0: dirt(2) })).slots[0], dirt(1));
    const pick = withSlots({ 0: { item: 'wooden_pickaxe', count: 1, damage: 57 } });
    assert.deepEqual(wearHeld(pick, 1).slots[0], { item: 'wooden_pickaxe', count: 1, damage: 58 });
    assert.equal(wearHeld(pick, 2).slots[0], null);
  });

  test('a stored inventory is read back sanitised', () => {
    const read = parseInventory({ slots: [{ item: 'dirt', count: 99 }, { item: 'unknown', count: 1 }, { item: 'iron_sword', count: 1, damage: 3 }], selected: 2 });
    assert.deepEqual(read?.slots.slice(0, 3), [dirt(64), null, { item: 'iron_sword', count: 1, damage: 3 }]);
    assert.equal(read?.selected, 2);
    assert.equal(parseInventory('nope'), null);
  });
});
