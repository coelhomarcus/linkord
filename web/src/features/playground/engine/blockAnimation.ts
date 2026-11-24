import { BLOCK, TORCH_ON_FLOOR, TORCH_ON_WALL } from '@game/blocks';
import type { Block } from '@game/blocks';

// Blocks that show something on their own now and then, the block game's way
// (its animateTick): every tick, cells picked at random around the player (667
// within 16 blocks and 667 within 32, the nearer the likelier) get the chance,
// so a torch nearby smokes and flickers about once a second and one far off
// rarely. So far only torches: a puff of smoke and a flame at the tip.

/** each pass: how far from the player, and how many cells it picks */
const PASSES = [{ radius: 16, tries: 667 }, { radius: 32, tries: 667 }] as const;

/** The way each Facing points (+z, -x, -z, +x). */
const FACING_STEPS = [[0, 1], [-1, 0], [0, -1], [1, 0]] as const;

/** Where a torch's flame is in its cell (0..1): over a floor torch's stick, or out from a wall torch's wall
 * (the game's numbers, which its tilted model matches). */
export function torchFlame(state: number): [number, number, number] {
  if (state === TORCH_ON_FLOOR) return [0.5, 0.7, 0.5];
  const [dx, dz] = FACING_STEPS[(state - TORCH_ON_WALL) & 3]!;
  return [0.5 - 0.27 * dx, 0.92, 0.5 - 0.27 * dz];
}

interface Cells {
  get(x: number, y: number, z: number): Block;
  stateAt(x: number, y: number, z: number): number;
}

/** One tick's picks around the cell (x, y, z): `emit` is told of each torch picked, with its state. */
export function animateBlocks(
  grid: Cells, x: number, y: number, z: number,
  emit: (x: number, y: number, z: number, state: number) => void,
  random: () => number = Math.random,
): void {
  for (const { radius, tries } of PASSES) {
    const offset = () => Math.floor(random() * radius) - Math.floor(random() * radius);
    for (let i = 0; i < tries; i++) {
      const bx = x + offset();
      const by = y + offset();
      const bz = z + offset();
      if (grid.get(bx, by, bz) === BLOCK.torch) emit(bx, by, bz, grid.stateAt(bx, by, bz));
    }
  }
}
