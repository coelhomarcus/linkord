import type { ParseKeys } from 'i18next';
import { BLOCK } from '../islandMap';
import type { Block } from '../islandMap';

// Every item there can be, by id (the block game's names). An item is what a
// slot holds: how many stack together, what it is called and how its icon is
// drawn. For now there are the island's blocks, as items; a new item (a tool, a
// weapon with its own damage) is one more entry here, and a new kind of icon
// one more case in itemIcons.ts.

type ItemName = Extract<ParseKeys<'playground'>, `items.${string}`>;

/** How an item looks in a slot. */
export type ItemIcon = { kind: 'block'; block: Exclude<Block, 0> };

export interface ItemDef {
  id: string;
  /** its name in the playground namespace */
  name: ItemName;
  /** how many fit in one slot */
  maxStack: number;
  icon: ItemIcon;
}

const blockItem = (id: string, name: ItemName, block: Exclude<Block, 0>): ItemDef => ({ id, name, maxStack: 64, icon: { kind: 'block', block } });

const ITEMS: ReadonlyMap<string, ItemDef> = new Map([
  blockItem('grass_block', 'items.grassBlock', BLOCK.grass),
  blockItem('dirt', 'items.dirt', BLOCK.dirt),
  blockItem('stone', 'items.stone', BLOCK.stone),
  blockItem('sand', 'items.sand', BLOCK.sand),
  blockItem('oak_log', 'items.oakLog', BLOCK.log),
  blockItem('oak_leaves', 'items.oakLeaves', BLOCK.leaves),
  blockItem('oak_planks', 'items.oakPlanks', BLOCK.planks),
  blockItem('polished_blackstone', 'items.polishedBlackstone', BLOCK.frame),
].map((item) => [item.id, item]));

/** An item by id, or null for one this version does not know. */
export function itemDef(id: string): ItemDef | null {
  return ITEMS.get(id) ?? null;
}

/** How many of `id` fit in one slot; 1 for an unknown item, so it never merges. */
export function maxStackOf(id: string): number {
  return itemDef(id)?.maxStack ?? 1;
}
