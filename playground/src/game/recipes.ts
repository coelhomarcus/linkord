import { TOOL_TIERS, type ToolTier } from './items.js';

// Crafting, the block game's way: a grid (2×2 in the inventory, 3×3 on a
// crafting table) matches a recipe when its items, cut down to the smallest
// rectangle around them, make the recipe's shape, or its mirror image; a
// shapeless recipe only counts its items. Taking the result uses up one item
// from every filled cell of the grid.

export interface Stack { item: string; count: number }

interface Shaped { pattern: readonly string[]; key: Readonly<Record<string, string>>; result: Stack }
interface Shapeless { ingredients: readonly string[]; result: Stack }
type Recipe = Shaped | Shapeless;

const TOOL_MATERIAL: Record<ToolTier, string> = {
  wooden: 'oak_planks', stone: 'cobblestone', iron: 'iron_ingot', golden: 'gold_ingot', diamond: 'diamond',
};
const TOOL_SHAPES = {
  pickaxe: ['XXX', ' # ', ' # '],
  axe: ['XX', 'X#', ' #'],
  shovel: ['X', '#', '#'],
  sword: ['X', 'X', '#'],
} as const;

const RECIPES: readonly Recipe[] = [
  { ingredients: ['oak_log'], result: { item: 'oak_planks', count: 4 } },
  { pattern: ['#', '#'], key: { '#': 'oak_planks' }, result: { item: 'stick', count: 4 } },
  { pattern: ['##', '##'], key: { '#': 'oak_planks' }, result: { item: 'crafting_table', count: 1 } },
  { pattern: ['###', '# #', '###'], key: { '#': 'cobblestone' }, result: { item: 'furnace', count: 1 } },
  { pattern: ['###', '# #', '###'], key: { '#': 'oak_planks' }, result: { item: 'chest', count: 1 } },
  { pattern: ['C', '#'], key: { C: 'coal', '#': 'stick' }, result: { item: 'torch', count: 4 } },
  { pattern: ['C', '#'], key: { C: 'charcoal', '#': 'stick' }, result: { item: 'torch', count: 4 } },
  { ingredients: ['iron_ingot'], result: { item: 'iron_nugget', count: 9 } },
  { pattern: ['###', '###', '###'], key: { '#': 'iron_nugget' }, result: { item: 'iron_ingot', count: 1 } },
  { pattern: ['###', '#T#', '###'], key: { '#': 'iron_nugget', T: 'torch' }, result: { item: 'lantern', count: 1 } },
  ...TOOL_TIERS.flatMap((tier) => (Object.entries(TOOL_SHAPES) as [keyof typeof TOOL_SHAPES, readonly string[]][]).map(([kind, pattern]): Shaped => ({
    pattern, key: { X: TOOL_MATERIAL[tier], '#': 'stick' }, result: { item: `${tier}_${kind}`, count: 1 },
  }))),
];

/** The grid's items cut down to the rectangle around them, row by row ('' for an empty cell). */
function trim(grid: readonly (Stack | null)[], width: number): string[][] {
  const rows: string[][] = [];
  for (let y = 0; y < grid.length / width; y++) rows.push(Array.from({ length: width }, (_, x) => grid[y * width + x]?.item ?? ''));
  const filledRows = rows.map((row) => row.some(Boolean));
  const top = filledRows.indexOf(true);
  if (top < 0) return [];
  const bottom = filledRows.lastIndexOf(true);
  const columns = Array.from({ length: width }, (_, x) => rows.some((row) => row[x]));
  const left = columns.indexOf(true);
  const right = columns.lastIndexOf(true);
  return rows.slice(top, bottom + 1).map((row) => row.slice(left, right + 1));
}

function matchesShape(cells: string[][], recipe: Shaped, mirrored: boolean): boolean {
  if (cells.length !== recipe.pattern.length) return false;
  return recipe.pattern.every((line, y) => {
    const row = cells[y]!;
    if (row.length !== line.length) return false;
    return [...line].every((symbol, x) => (symbol === ' ' ? '' : recipe.key[symbol]) === row[mirrored ? line.length - 1 - x : x]);
  });
}

/** The recipe the grid (`width` cells a row) makes, or null. */
export function matchRecipe(grid: readonly (Stack | null)[], width: number): Stack | null {
  const cells = trim(grid, width);
  if (cells.length === 0) return null;
  const items = cells.flat().filter(Boolean).sort();
  for (const recipe of RECIPES) {
    if ('ingredients' in recipe) {
      const wanted = [...recipe.ingredients].sort();
      if (wanted.length === items.length && wanted.every((item, i) => item === items[i])) return recipe.result;
    } else if (matchesShape(cells, recipe, false) || matchesShape(cells, recipe, true)) {
      return recipe.result;
    }
  }
  return null;
}
