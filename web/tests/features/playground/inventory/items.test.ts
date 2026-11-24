import { describe, expect, it } from 'vitest';
import { ITEM_IDS } from '@game/items';
import { itemIcon, itemName, wearOf } from '@/features/playground/inventory/items';
import ptBR from '@/features/playground/locales/pt-BR.json';

describe('items in this browser', () => {
  it('names and draws every item the game has', () => {
    for (const id of ITEM_IDS) {
      const key = itemName(id)!.slice('items.'.length) as keyof typeof ptBR.items;
      expect(ptBR.items[key], id).toBeTruthy();
      expect(itemIcon(id), id).not.toBeNull();
    }
    expect(itemIcon('oak_planks')).toMatchObject({ kind: 'block' });
    expect(itemIcon('iron_pickaxe')).toMatchObject({ kind: 'sprite' });
    expect(itemName('nothing')).toBeNull();
  });

  it('tells how worn a tool is', () => {
    expect(wearOf({ item: 'wooden_pickaxe', damage: 59 / 2 })).toBeCloseTo(0.5);
    expect(wearOf({ item: 'wooden_pickaxe' })).toBeNull();
    expect(wearOf({ item: 'dirt', damage: 3 })).toBeNull();
  });
});
