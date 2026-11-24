import { BLOCK, blockDef, isReplaceable, LANTERN, placedState, TORCH_ON_FLOOR, TORCH_ON_WALL, type Block, type Facing } from './blocks.js';
import type { BlockGrid } from './grid.js';

// Blocks that hang on another: a torch on the floor or a wall, a lantern on
// the floor or under a ceiling. Each one's state says which neighbour holds it
// up; placing one where nothing would hold it is refused, and breaking what
// holds it breaks it too, as in the game. Shared by the service, which decides,
// and the browser, which predicts.

type Offset = readonly [number, number, number];

/** The way each Facing points (+z, -x, -z, +x). */
const FACING_OFFSETS: readonly Offset[] = [[0, 0, 1], [-1, 0, 0], [0, 0, -1], [1, 0, 0]];
const BELOW: Offset = [0, -1, 0];
const ABOVE: Offset = [0, 1, 0];

const isAttached = (block: number): boolean => block === BLOCK.torch || block === BLOCK.lantern;

/** The neighbour (as an offset) that holds an attached block up in that state, or null for any other block. */
function supportOffset(block: number, state: number): Offset | null {
  if (block === BLOCK.torch) {
    if (state === TORCH_ON_FLOOR) return BELOW;
    // a torch on a wall points away from it
    const [dx, dy, dz] = FACING_OFFSETS[(state - TORCH_ON_WALL) & 3]!;
    return [-dx, dy, -dz];
  }
  if (block === BLOCK.lantern) return state === LANTERN.hanging ? ABOVE : BELOW;
  return null;
}

/** Whether a block can hold a torch or lantern up: a whole solid block (not a chest, a little smaller). */
function holdsUp(block: number): boolean {
  return blockDef(block).solid && block !== BLOCK.chest && block !== BLOCK.creativeChest;
}

/** Whether the attached block at (x, y, z), in its state, has what holds it up (true for any other block). */
function isSupported(grid: BlockGrid, x: number, y: number, z: number): boolean {
  const offset = supportOffset(grid.get(x, y, z), grid.stateAt(x, y, z));
  return !offset || holdsUp(grid.get(x + offset[0], y + offset[1], z + offset[2]));
}

/** Whether `block` may go in a cell holding `there`: anything replaceable, but a torch not into water. */
export function canPlaceIn(block: number, there: number): boolean {
  return isReplaceable(there) && !(block === BLOCK.torch && there === BLOCK.water);
}

/** The state `block` takes placed at (x, y, z) against `face` (blocks.ts's placedState), or null when it
 * hangs on something and nothing there holds it up. A torch or lantern that cannot hang where it was put
 * tries the floor, then (a torch) the walls, then (a lantern) the ceiling, as the game's placement does. */
export function stateForPlacing(grid: BlockGrid, block: Block, x: number, y: number, z: number, face: number, facing: Facing = 0): number | null {
  const wanted = placedState(block, face, facing);
  if (!isAttached(block)) return wanted;
  const others = block === BLOCK.torch
    ? [TORCH_ON_FLOOR, ...FACING_OFFSETS.map((_, i) => TORCH_ON_WALL + i)]
    : [LANTERN.standing, LANTERN.hanging];
  for (const state of [wanted, ...others]) {
    const [dx, dy, dz] = supportOffset(block, state)!;
    if (holdsUp(grid.get(x + dx, y + dy, z + dz))) return state;
  }
  return null;
}

/** The attached blocks around (x, y, z) that nothing holds up any more (after that cell changed). */
export function unsupportedAround(grid: BlockGrid, x: number, y: number, z: number): [number, number, number][] {
  const fallen: [number, number, number][] = [];
  for (const [dx, dy, dz] of [...FACING_OFFSETS, BELOW, ABOVE]) {
    const nx = x + dx;
    const ny = y + dy;
    const nz = z + dz;
    if (isAttached(grid.get(nx, ny, nz)) && !isSupported(grid, nx, ny, nz)) fallen.push([nx, ny, nz]);
  }
  return fallen;
}
