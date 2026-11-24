import { BLOCK, blockDef, type Block } from './blocks.js';
import type { BlockGrid } from './grid.js';
import { itemDef } from './items.js';

// Breaking blocks, the block game's way: a block takes its hardness × 1.5
// seconds by hand when a hand may harvest it, × 5 when it needs a pickaxe
// that is not there (and then drops nothing); the right tool divides that by
// its speed. A tool wears by one for each block it breaks, a sword by two.

/** Ticks (20 a second) the held item takes to break `block`, or null for one that never breaks. */
export function breakTicks(block: number, heldItem: string | null): number | null {
  const def = blockDef(block);
  if (def.hardness < 0 || block === BLOCK.air) return null;
  if (def.hardness === 0) return 0;
  const tool = heldItem ? itemDef(heldItem)?.tool : undefined;
  const harvests = canHarvest(block, heldItem);
  // a sword cuts through leaves, as the game's does
  const speed = tool && def.tool === tool.kind ? tool.speed : tool?.kind === 'sword' && block === BLOCK.leaves ? 1.5 : 1;
  return Math.ceil(((def.hardness * (harvests ? 1.5 : 5)) / speed) * 20);
}

/** Whether breaking `block` with the held item drops anything. */
export function canHarvest(block: number, heldItem: string | null): boolean {
  const def = blockDef(block);
  if (def.needs === null) return true;
  const tool = heldItem ? itemDef(heldItem)?.tool : undefined;
  return tool?.kind === 'pickaxe' && tool.level >= def.needs;
}

/** an oak's leaves drop a stick one time in 50 and an apple one in 200, as in the game */
const LEAF_DROPS = { stick: 0.02, apple: 0.005 } as const;

/** What breaking `block` drops (`roll` in [0, 1), the chance for what leaves drop), or null. */
export function dropOf(block: number, heldItem: string | null, roll: number): string | null {
  if (!canHarvest(block, heldItem)) return null;
  if (block === BLOCK.leaves) return roll < LEAF_DROPS.stick ? 'stick' : roll >= 1 - LEAF_DROPS.apple ? 'apple' : null;
  return blockDef(block).drop;
}

/** How much a block broken with the held item wears it. */
export function wearForBreaking(heldItem: string | null, block: number): number {
  const tool = heldItem ? itemDef(heldItem)?.tool : undefined;
  if (!tool || blockDef(block).hardness === 0) return 0;
  return tool.kind === 'sword' ? 2 : 1;
}

/** How much a hit with the held item wears it. */
export function wearForHitting(heldItem: string | null): number {
  const tool = heldItem ? itemDef(heldItem)?.tool : undefined;
  if (!tool) return 0;
  return tool.kind === 'sword' ? 1 : 2;
}

/** What a hit with the held item deals: a hand 1, a tool its damage. */
export function hitDamage(heldItem: string | null): number {
  return (heldItem ? itemDef(heldItem)?.tool?.damage : undefined) ?? 1;
}

/** What a broken cell becomes: water when water is beside or above it (the sea fills a hole dug into it). */
export function brokenInto(grid: BlockGrid, x: number, y: number, z: number): Block {
  const water = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]].some(([dx, dy, dz]) => grid.isWater(x + dx!, y + dy!, z + dz!));
  return water ? BLOCK.water : BLOCK.air;
}
