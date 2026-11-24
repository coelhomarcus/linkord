import type { BlockGrid } from './grid.js';

// Items on the ground: a block broken, a stack thrown, everything someone
// carried when they died. Each falls from where it appeared, with the speed it
// was given, and comes to rest on the ground (slowly sinking through water);
// the service works out where, and every browser plays the same fall from the
// same start, so all agree where it lies without being told every step.

const GRAVITY = 0.04;
const AIR_DRAG = 0.98;
const GROUND_FRICTION = 0.6 * 0.98;
const WATER_DRAG = 0.8;
const WATER_SINK = 0.02;
const HALF = 0.125;
/** an item falls for at most this many ticks before it is counted as resting where it is */
const MAX_FALL_TICKS = 400;

export interface Motion { x: number; y: number; z: number; vx: number; vy: number; vz: number }

/** How long an item lies on the ground before it vanishes, as in the game (5 minutes). */
export const DESPAWN_MS = 5 * 60 * 1000;
/** Before this long nobody picks it up: a block's drop (half a second), a thrown stack (two seconds). */
export const PICKUP_DELAY_MS = { broken: 500, thrown: 2000 } as const;
/** How near (blocks, from the feet) an item must be to be picked up: the body grown by 1 across, 0.5 up and down. */
const PICKUP_REACH = { across: 1.3, below: 0.5, above: 2.3 } as const;

function blocked(grid: BlockGrid, x: number, y: number, z: number): boolean {
  for (const dx of [-HALF, HALF]) for (const dz of [-HALF, HALF]) if (grid.isSolid(Math.floor(x + dx), Math.floor(y), Math.floor(z + dz))) return true;
  return false;
}

/** One tick of an item's fall, in place. Returns whether it is at rest. */
export function stepDrop(grid: BlockGrid, item: Motion): boolean {
  const inWater = grid.isWater(Math.floor(item.x), Math.floor(item.y + HALF), Math.floor(item.z));
  item.vy -= inWater ? WATER_SINK : GRAVITY;
  if (inWater) item.vy = Math.max(item.vy, -0.06);
  // down (or up) first, then across one axis at a time, stopping flush at a block
  const ny = item.y + item.vy;
  let onGround = false;
  if (item.vy < 0 && blocked(grid, item.x, ny, item.z)) {
    item.y = Math.floor(ny) + 1;
    item.vy = 0;
    onGround = true;
  } else if (item.vy > 0 && blocked(grid, item.x, ny + HALF * 2, item.z)) {
    item.vy = 0;
  } else {
    item.y = ny;
  }
  const nx = item.x + item.vx;
  if (blocked(grid, nx, item.y + 0.01, item.z)) item.vx = 0;
  else item.x = nx;
  const nz = item.z + item.vz;
  if (blocked(grid, item.x, item.y + 0.01, nz)) item.vz = 0;
  else item.z = nz;
  const drag = inWater ? WATER_DRAG : AIR_DRAG;
  const friction = onGround ? GROUND_FRICTION : drag;
  item.vx *= friction;
  item.vz *= friction;
  item.vy *= drag;
  if (item.y < 0) {
    item.y = 0;
    return true;
  }
  return onGround && Math.abs(item.vx) < 0.005 && Math.abs(item.vz) < 0.005;
}

/** Where an item that starts with `start` comes to rest. */
export function restingPlace(grid: BlockGrid, start: Motion): { x: number; y: number; z: number } {
  const item = { ...start };
  for (let tick = 0; tick < MAX_FALL_TICKS; tick++) if (stepDrop(grid, item)) break;
  return { x: item.x, y: item.y, z: item.z };
}

/** Whether an item at rest at `item` is within the reach of someone whose feet are at `feet`. */
export function withinPickup(feet: { x: number; y: number; z: number }, item: { x: number; y: number; z: number }): boolean {
  return Math.abs(item.x - feet.x) <= PICKUP_REACH.across && Math.abs(item.z - feet.z) <= PICKUP_REACH.across
    && item.y >= feet.y - PICKUP_REACH.below && item.y <= feet.y + PICKUP_REACH.above;
}
