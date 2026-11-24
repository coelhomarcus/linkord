import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { InventoryScreen } from '@/features/playground/inventory/InventoryScreen';
import { InventoryStore, addItem } from '@/features/playground/inventory/inventory';
import { defaultSkin } from '@/features/playground/skins/defaultSkins';

function Screen({ store, onClose }: { store: InventoryStore; onClose: () => void }) {
  return <InventoryScreen store={store} inventory={store.get()} skin={defaultSkin('me')} scale={2} onClose={onClose} />;
}

function setup() {
  const store = new InventoryStore();
  store.update((inventory) => addItem(inventory, { item: 'stone', count: 10 }).inventory);
  const onClose = vi.fn();
  const view = render(<Screen store={store} onClose={onClose} />);
  const rerender = () => view.rerender(<Screen store={store} onClose={onClose} />);
  return { store, onClose, rerender };
}

describe('InventoryScreen', () => {
  it('picks a stack up with a click and puts it down in another slot', () => {
    const { store, rerender } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Pedra (10)' }));
    expect(store.get().cursor).toEqual({ item: 'stone', count: 10 });
    rerender();
    fireEvent.click(screen.getAllByRole('button', { name: 'Espaço vazio' })[10]!);
    expect(store.get().cursor).toBeNull();
    expect(store.get().slots.filter(Boolean)).toEqual([{ item: 'stone', count: 10 }]);
    expect(store.get().slots[0]).toBeNull();
  });

  it('takes half with the right button and moves a stack inside with Shift', () => {
    const { store, rerender } = setup();
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Pedra (10)' }));
    expect(store.get().cursor).toEqual({ item: 'stone', count: 5 });
    const other = setup();
    other.rerender();
    fireEvent.click(screen.getAllByRole('button', { name: 'Pedra (10)' }).at(-1)!, { shiftKey: true });
    expect(other.store.get().slots.findIndex(Boolean)).toBe(9);
    rerender();
  });

  it('swaps the hovered slot with a hotbar slot on a number key, and closes on E or Esc', () => {
    const { store, onClose } = setup();
    const stone = screen.getByRole('button', { name: 'Pedra (10)' });
    fireEvent.pointerEnter(stone);
    act(() => { fireEvent.keyDown(stone, { code: 'Digit4' }); });
    expect(store.get().slots[3]).toEqual({ item: 'stone', count: 10 });
    fireEvent.keyDown(stone, { code: 'KeyE' });
    fireEvent.keyDown(stone, { code: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
