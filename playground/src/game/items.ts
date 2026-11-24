import { BLOCK, COLORED_KINDS, COLORS, coloredBlock, type Block, type ToolKind } from './blocks.js';

// Every item a slot can hold, by the block game's ids: the blocks one can carry
// and place, what ores and furnaces give, and the four tools in five materials.
// The browser names and draws them (web/src/features/playground/inventory).

export type ToolTier = 'wooden' | 'stone' | 'iron' | 'golden' | 'diamond';

interface ToolDef {
  kind: ToolKind;
  tier: ToolTier;
  /** the pickaxe tier it counts as for drops (blocks.ts `needs`) */
  level: number;
  /** how many times faster than a hand it breaks a block it is meant for */
  speed: number;
  /** what a hit with it deals (the game's 1.8 values; a hand deals 1) */
  damage: number;
  /** uses before it breaks */
  durability: number;
}

export interface ItemDef {
  id: string;
  maxStack: number;
  /** the block it places, if any */
  places?: Block;
  tool?: ToolDef;
  /** ticks it burns in a furnace (200 smelt one item) */
  fuel?: number;
}

const TIERS: Record<ToolTier, { level: number; speed: number; durability: number; bonus: number }> = {
  wooden: { level: 0, speed: 2, durability: 59, bonus: 0 },
  stone: { level: 1, speed: 4, durability: 131, bonus: 1 },
  iron: { level: 2, speed: 6, durability: 250, bonus: 2 },
  golden: { level: 0, speed: 12, durability: 32, bonus: 0 },
  diamond: { level: 3, speed: 8, durability: 1561, bonus: 3 },
};
/** a hit's damage with each tool made of wood or gold; every better material adds one */
const BASE_DAMAGE: Record<ToolKind, number> = { sword: 5, axe: 4, pickaxe: 3, shovel: 2 };
export const TOOL_TIERS = Object.keys(TIERS) as ToolTier[];
const TOOL_KINDS: readonly ToolKind[] = ['sword', 'pickaxe', 'axe', 'shovel'];

const block = (id: string, places: Block, fuel?: number): ItemDef => ({ id, maxStack: 64, places, ...(fuel ? { fuel } : {}) });
const material = (id: string, fuel?: number): ItemDef => ({ id, maxStack: 64, ...(fuel ? { fuel } : {}) });

function tool(tier: ToolTier, kind: ToolKind): ItemDef {
  const { level, speed, durability, bonus } = TIERS[tier];
  return {
    id: `${tier}_${kind}`,
    maxStack: 1,
    tool: { kind, tier, level, speed, durability, damage: BASE_DAMAGE[kind] + bonus },
    ...(tier === 'wooden' ? { fuel: 200 } : {}),
  };
}

const ITEMS: ReadonlyMap<string, ItemDef> = new Map([
  block('grass_block', BLOCK.grass),
  block('dirt', BLOCK.dirt),
  block('stone', BLOCK.stone),
  block('cobblestone', BLOCK.cobblestone),
  block('sand', BLOCK.sand),
  block('gravel', BLOCK.gravel),
  block('oak_log', BLOCK.log, 300),
  block('oak_leaves', BLOCK.leaves),
  block('oak_planks', BLOCK.planks, 300),
  block('crafting_table', BLOCK.craftingTable, 300),
  block('furnace', BLOCK.furnace),
  block('iron_ore', BLOCK.ironOre),
  block('gold_ore', BLOCK.goldOre),
  block('glass', BLOCK.glass),
  block('chest', BLOCK.chest, 300),
  block('terracotta', BLOCK.terracotta),
  block('torch', BLOCK.torch),
  block('lantern', BLOCK.lantern),
  block('glowstone', BLOCK.glowstone),
  ...COLORED_KINDS.flatMap((kind) => COLORS.map((color) => block(`${color}_${kind}`, coloredBlock(kind, color)))),
  material('stick', 100),
  material('coal', 1600),
  material('charcoal', 1600),
  material('iron_ingot'),
  material('iron_nugget'),
  material('gold_ingot'),
  material('diamond'),
  ...TOOL_TIERS.flatMap((tier) => TOOL_KINDS.map((kind) => tool(tier, kind))),
].map((item) => [item.id, item]));

/** Every item id, in the order a list of them shows. */
export const ITEM_IDS: readonly string[] = [...ITEMS.keys()];

/** An item by id, or null for one this version does not know. */
export function itemDef(id: string): ItemDef | null {
  return ITEMS.get(id) ?? null;
}

/** How many of `id` fit in one slot; 1 for an unknown item, so it never merges. */
export function maxStackOf(id: string): number {
  return itemDef(id)?.maxStack ?? 1;
}
