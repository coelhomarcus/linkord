// Every block a playground's world is made of, by the number it is stored as
// (a world is one byte per cell, grid.ts). The rules are the block game's: how
// hard each one is to break, which tool breaks it faster, which pickaxe it
// needs to drop anything, and what it drops. Shared by the playground service,
// which decides every change, and the browser, which draws the world and
// predicts the changes it asks for (web/src/features/playground, as `@game/`).
//
// Numbers are stored in saved worlds: never reuse or renumber one. Each cell
// also has a state byte (grid.ts) for what is not the block itself: which way a
// log lies; 0 for a block that has nothing more to say.

export const BLOCK = {
  air: 0, grass: 1, dirt: 2, stone: 3, sand: 4, log: 5, leaves: 6,
  /** the big screen's wall (polished blackstone); nobody breaks it */
  frame: 7,
  planks: 8, cobblestone: 9, coalOre: 10, ironOre: 11, goldOre: 12, diamondOre: 13, bedrock: 14,
  water: 15, craftingTable: 16, furnace: 17, gravel: 18, glass: 19,
  // the coloured blocks, 16 in a row each in COLORS' order (coloredBlock)
  whiteWool: 20, orangeWool: 21, magentaWool: 22, lightBlueWool: 23, yellowWool: 24, limeWool: 25, pinkWool: 26, grayWool: 27,
  lightGrayWool: 28, cyanWool: 29, purpleWool: 30, blueWool: 31, brownWool: 32, greenWool: 33, redWool: 34, blackWool: 35,
  whiteConcrete: 36, orangeConcrete: 37, magentaConcrete: 38, lightBlueConcrete: 39, yellowConcrete: 40, limeConcrete: 41, pinkConcrete: 42, grayConcrete: 43,
  lightGrayConcrete: 44, cyanConcrete: 45, purpleConcrete: 46, blueConcrete: 47, brownConcrete: 48, greenConcrete: 49, redConcrete: 50, blackConcrete: 51,
  whiteTerracotta: 52, orangeTerracotta: 53, magentaTerracotta: 54, lightBlueTerracotta: 55, yellowTerracotta: 56, limeTerracotta: 57, pinkTerracotta: 58, grayTerracotta: 59,
  lightGrayTerracotta: 60, cyanTerracotta: 61, purpleTerracotta: 62, blueTerracotta: 63, brownTerracotta: 64, greenTerracotta: 65, redTerracotta: 66, blackTerracotta: 67,
  terracotta: 68,
  chest: 69,
  /** opens a screen with every item; nobody breaks it (game/worldGen.ts puts one by the plaza) */
  creativeChest: 70,
} as const;
export type Block = (typeof BLOCK)[keyof typeof BLOCK];
/** one past the largest block number */
export const BLOCK_COUNT = 71;

/** The game's sixteen colours, in its order: the coloured blocks are numbered by it. */
export const COLORS = [
  'white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray',
  'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black',
] as const;
export type Color = (typeof COLORS)[number];

/** Each family of coloured blocks, by its white one. */
const COLORED = { wool: BLOCK.whiteWool, concrete: BLOCK.whiteConcrete, terracotta: BLOCK.whiteTerracotta } as const;
export type ColoredKind = keyof typeof COLORED;
export const COLORED_KINDS = Object.keys(COLORED) as ColoredKind[];

/** The block of a family in a colour. */
export function coloredBlock(kind: ColoredKind, color: Color): Block {
  return (COLORED[kind] + COLORS.indexOf(color)) as Block;
}

export type ToolKind = 'pickaxe' | 'axe' | 'shovel' | 'sword';

export interface BlockDef {
  /** the game's hardness: seconds to break by hand are 1.5× this with the right tool tier, 5× without;
   * negative never breaks */
  hardness: number;
  /** the tool that breaks it faster */
  tool: ToolKind | null;
  /** the pickaxe tier it needs to drop anything (0 wood or gold, 1 stone, 2 iron, 3 diamond); null: any */
  needs: number | null;
  /** the item breaking it drops, or null */
  drop: string | null;
  /** stops a body (water does not) */
  solid: boolean;
  /** hides the faces behind it and stops the light: false for air, leaves, glass and water */
  opaque: boolean;
  /** light lost passing through a cell of it (0..15) */
  lightOpacity: number;
}

const solid = (hardness: number, tool: ToolKind | null, drop: string | null, needs: number | null = null): BlockDef =>
  ({ hardness, tool, needs, drop, solid: true, opaque: true, lightOpacity: 15 });

/** A family's sixteen blocks, each dropping itself (`white_wool`...). */
function coloredDefs(kind: ColoredKind, def: BlockDef): Record<number, BlockDef> {
  return Object.fromEntries(COLORS.map((color, i) => [COLORED[kind] + i, { ...def, drop: `${color}_${kind}` }]));
}

const BLOCK_DEFS = {
  [BLOCK.air]: { hardness: 0, tool: null, needs: null, drop: null, solid: false, opaque: false, lightOpacity: 0 },
  [BLOCK.grass]: solid(0.6, 'shovel', 'dirt'),
  [BLOCK.dirt]: solid(0.5, 'shovel', 'dirt'),
  [BLOCK.stone]: solid(1.5, 'pickaxe', 'cobblestone', 0),
  [BLOCK.sand]: solid(0.5, 'shovel', 'sand'),
  [BLOCK.log]: solid(2, 'axe', 'oak_log'),
  // the game drops a sapling now and then, or a stick; here a stick, one time in fifty (mining.ts)
  [BLOCK.leaves]: { ...solid(0.2, null, null), opaque: false, lightOpacity: 1 },
  [BLOCK.frame]: solid(-1, null, null),
  [BLOCK.planks]: solid(2, 'axe', 'oak_planks'),
  [BLOCK.cobblestone]: solid(2, 'pickaxe', 'cobblestone', 0),
  [BLOCK.coalOre]: solid(3, 'pickaxe', 'coal', 0),
  [BLOCK.ironOre]: solid(3, 'pickaxe', 'iron_ore', 1),
  [BLOCK.goldOre]: solid(3, 'pickaxe', 'gold_ore', 2),
  [BLOCK.diamondOre]: solid(3, 'pickaxe', 'diamond', 2),
  [BLOCK.bedrock]: solid(-1, null, null),
  [BLOCK.water]: { hardness: -1, tool: null, needs: null, drop: null, solid: false, opaque: false, lightOpacity: 2 },
  [BLOCK.craftingTable]: solid(2.5, 'axe', 'crafting_table'),
  [BLOCK.furnace]: solid(3.5, 'pickaxe', 'furnace', 0),
  [BLOCK.gravel]: solid(0.6, 'shovel', 'gravel'),
  // glass breaks into nothing, as in the game
  [BLOCK.glass]: { ...solid(0.3, null, null), opaque: false, lightOpacity: 0 },
  // wool is the shears' (which do not exist here): a hand takes it as fast as anything
  ...coloredDefs('wool', solid(0.8, null, null)),
  ...coloredDefs('concrete', solid(1.8, 'pickaxe', null, 0)),
  ...coloredDefs('terracotta', solid(1.25, 'pickaxe', null, 0)),
  [BLOCK.terracotta]: solid(1.25, 'pickaxe', 'terracotta', 0),
  // a chest is drawn as a model (its latch stands out of the cell) and lets the light through
  [BLOCK.chest]: { ...solid(2.5, 'axe', 'chest'), opaque: false, lightOpacity: 0 },
  [BLOCK.creativeChest]: { ...solid(-1, null, null), opaque: false, lightOpacity: 0 },
} as Record<Block, BlockDef>;

export function isBlock(value: number): value is Block {
  return Number.isInteger(value) && value >= 0 && value < BLOCK_COUNT;
}

export function blockDef(block: number): BlockDef {
  return BLOCK_DEFS[(isBlock(block) ? block : BLOCK.air) as Block];
}

/** What a placed block may take the place of. */
export const isReplaceable = (block: number): boolean => block === BLOCK.air || block === BLOCK.water;
/** Where a block's front faces (a chest's): +z, -x, -z, +x. */
export type Facing = 0 | 1 | 2 | 3;

/** Blocks whose state is where their front faces. */
export const isFacing = (block: number): boolean => block === BLOCK.chest || block === BLOCK.creativeChest;

/** The way from the cell (x, z) toward a point: where a block placed there by someone standing at the
 * point faces. */
export function facingToward(at: { x: number; z: number }, x: number, z: number): Facing {
  const dx = at.x - (x + 0.5);
  const dz = at.z - (z + 0.5);
  if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? 3 : 1;
  return dz > 0 ? 0 : 2;
}

/** Which way a log lies: its state. */
export const LOG_AXIS = { y: 0, x: 1, z: 2 } as const;

/** How many states a block has (state numbers below this are its own; 0 always is). */
function stateCount(block: number): number {
  if (block === BLOCK.log) return 3;
  return isFacing(block) ? 4 : 1;
}

/** A state byte that means something for that block; anything else is read as 0. */
export function validState(block: number, state: number): number {
  return Number.isInteger(state) && state >= 0 && state < stateCount(block) ? state : 0;
}

/** The state a block takes as it is placed against `face` (+x, -x, +y, -y, +z, -z, of the block it was
 * placed on; -1 unknown) by someone it would face (`facing`): a log lies along the way it was put, a chest
 * faces whoever put it, as in the game. */
export function placedState(block: number, face: number, facing: Facing = 0): number {
  if (block === BLOCK.log && face >= 0 && face < 6) return face < 2 ? LOG_AXIS.x : face < 4 ? LOG_AXIS.y : LOG_AXIS.z;
  if (isFacing(block)) return facing;
  return 0;
}

/** What a right click opens instead of placing against. */
export const isUsable = (block: number): boolean =>
  block === BLOCK.craftingTable || block === BLOCK.furnace || block === BLOCK.chest || block === BLOCK.creativeChest;
