import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { addItem, applyOp, createInventory, openContainer } from '@game/inventory';
import type { InventoryOp, Window } from '@game/inventory';
import { createFurnace } from '@game/smelting';
import { InventoryScreen } from '@/features/playground/inventory/InventoryScreen';
import { InventoryState } from '@/features/playground/inventory/inventory';
import { defaultSkin } from '@/features/playground/skins/defaultSkins';

/** The screen over a client inventory whose requests always go out, as the session wires it. */
function setup(start: Window = { inventory: addItem(createInventory(), { item: 'stone', count: 10 }).inventory, furnace: null }) {
  const state = new InventoryState();
  state.receive({ ack: 0, inventory: start.inventory, furnace: start.furnace });
  const sent: InventoryOp[] = [];
  const onClose = vi.fn();
  const onOp = (op: InventoryOp) => state.perform(op, (_seq, sentOp) => { sent.push(sentOp); return true; });
  const ui = () => <InventoryScreen window={state.getWindow()} furnaceAt={0} skin={defaultSkin('me')} scale={2} onOp={onOp} onClose={onClose} />;
  const view = render(ui());
  state.subscribe(() => view.rerender(ui()));
  return { state, sent, onClose };
}

describe('InventoryScreen', () => {
  it('picks a stack up with a click and puts it down in another slot, at once and sent', () => {
    const { state, sent } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Pedra (10)' }));
    expect(state.get().cursor).toEqual({ item: 'stone', count: 10 });
    fireEvent.click(screen.getAllByRole('button', { name: 'Espaço vazio' })[10]!);
    expect(state.get().cursor).toBeNull();
    expect(state.get().slots.filter(Boolean)).toEqual([{ item: 'stone', count: 10 }]);
    expect(state.get().slots[0]).toBeNull();
    expect(sent.map((op) => op.op)).toEqual(['click', 'click']);
  });

  it('swaps the hovered slot with a hotbar slot on a number key, and closes on E or Esc', () => {
    const { state, onClose } = setup();
    const stone = screen.getByRole('button', { name: 'Pedra (10)' });
    fireEvent.pointerEnter(stone);
    act(() => { fireEvent.keyDown(stone, { code: 'Digit4' }); });
    expect(state.get().slots[3]).toEqual({ item: 'stone', count: 10 });
    fireEvent.keyDown(stone, { code: 'KeyE' });
    fireEvent.keyDown(stone, { code: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('crafts planks from a log in the 2×2 grid', () => {
    const { state } = setup({ inventory: addItem(createInventory(), { item: 'oak_log', count: 1 }).inventory, furnace: null });
    fireEvent.click(screen.getByRole('button', { name: 'Tronco de carvalho (1)' }));
    // the grid's first cell comes after the armour and the off hand
    fireEvent.click(screen.getAllByRole('button', { name: 'Espaço vazio' })[5]!);
    fireEvent.click(screen.getByRole('button', { name: 'Tábuas de carvalho (4)' }));
    expect(state.get().cursor).toEqual({ item: 'oak_planks', count: 4 });
    expect(state.get().grid.every((cell) => cell === null)).toBe(true);
  });

  it('shows a crafting table\'s 3×3 grid and a furnace\'s slots', () => {
    const table = openContainer(createInventory(), { kind: 'table', x: 0, y: 0, z: 0 }).window;
    setup(table);
    expect(screen.getByRole('dialog', { name: 'Fabricação' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Espaço vazio' })).toHaveLength(9 + 36);
  });

  it('puts ore in a furnace with Shift', () => {
    const opened = openContainer(addItem(createInventory(), { item: 'iron_ore', count: 3 }).inventory, { kind: 'furnace', x: 0, y: 0, z: 0 }).window;
    const { state } = setup({ ...opened, furnace: createFurnace() });
    expect(screen.getByRole('dialog', { name: 'Fornalha' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Minério de ferro (3)' }), { shiftKey: true });
    expect(state.getWindow().furnace?.slots[0]).toEqual({ item: 'iron_ore', count: 3 });
  });
});

describe('InventoryState', () => {
  it('shows its own changes on top of the service\'s word until the service has them', () => {
    const state = new InventoryState();
    const start = addItem(createInventory(), { item: 'dirt', count: 5 }).inventory;
    state.receive({ ack: 0, inventory: start, furnace: null });
    state.perform({ op: 'select', slot: 3 }, () => true);
    expect(state.get().selected).toBe(3);
    // the service, before it read that request: the change still shows
    state.receive({ ack: 0, inventory: start, furnace: null });
    expect(state.get().selected).toBe(3);
    // it refused it after all: what it says stands
    state.receive({ ack: 1, inventory: start, furnace: null });
    expect(state.get().selected).toBe(0);
    // nothing is shown that could not be sent
    state.perform({ op: 'select', slot: 5 }, () => false);
    expect(state.get().selected).toBe(0);
    expect(applyOp({ inventory: start, furnace: null }, { op: 'select', slot: 2 }).window.inventory.selected).toBe(2);
  });
});
