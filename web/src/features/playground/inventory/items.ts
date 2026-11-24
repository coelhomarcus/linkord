import type { ParseKeys } from 'i18next';
import { itemDef } from '@game/items';
import type { Block } from '@game/blocks';

// How this browser names and draws each item (the items themselves are the
// game's, game/items.ts): a block as a little cube of its faces, anything else
// as its picture from the pack (assets/pixel-perfection/item/).

type ItemName = Extract<ParseKeys<'playground'>, `items.${string}`>;

/** How an item looks in a slot, in a hand and on the ground. */
export type ItemIcon = { kind: 'block'; block: Exclude<Block, 0> } | { kind: 'sprite'; url: string };

const SPRITES = import.meta.glob<string>('../assets/pixel-perfection/item/*.png', { eager: true, query: '?url', import: 'default' });

const spriteUrl = (id: string): string | null => SPRITES[`../assets/pixel-perfection/item/${id}.png`] ?? null;
const camel = (id: string) => id.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());

/** An item's name in the playground namespace, or null for one this version does not know. */
export function itemName(id: string): ItemName | null {
  return itemDef(id) ? (`items.${camel(id)}` as ItemName) : null;
}

export function itemIcon(id: string): ItemIcon | null {
  const def = itemDef(id);
  if (!def) return null;
  if (def.places !== undefined && def.places !== 0) return { kind: 'block', block: def.places };
  const url = spriteUrl(id);
  return url ? { kind: 'sprite', url } : null;
}

/** How worn a tool is, 0 (new) to 1 (about to break), or null for anything that does not wear. */
export function wearOf(stack: { item: string; damage?: number } | null): number | null {
  const durability = stack ? itemDef(stack.item)?.tool?.durability : undefined;
  if (!stack || !durability || !stack.damage) return null;
  return Math.min(1, stack.damage / durability);
}
