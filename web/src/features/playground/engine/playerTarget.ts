import { BODY_HEIGHT, HALF_WIDTH } from './playerPhysics';

// Who a punch lands on, the block game's way: a ray from the eyes along the
// view, as far as a player reaches another (3 blocks, shorter than for blocks),
// meeting each player's 0.6 × 1.8 box grown by 0.1 on every side, and stopped by
// the first block in the way.

/** How far a punch reaches, in blocks. */
export const ATTACK_REACH = 3;
/** the box a ray meets is a little larger than the one that collides */
const HIT_MARGIN = 0.1;

interface Vec { x: number; y: number; z: number }

interface Box { min: [number, number, number]; max: [number, number, number] }

/** Where along the ray (unit `direction`) it enters the box, or null if it misses (slab method). */
export function rayBoxDistance(origin: Vec, direction: Vec, box: Box): number | null {
  const o = [origin.x, origin.y, origin.z];
  const d = [direction.x, direction.y, direction.z];
  let near = -Infinity;
  let far = Infinity;
  for (let axis = 0; axis < 3; axis++) {
    if (Math.abs(d[axis]!) < 1e-12) {
      if (o[axis]! < box.min[axis]! || o[axis]! > box.max[axis]!) return null;
      continue;
    }
    let t0 = (box.min[axis]! - o[axis]!) / d[axis]!;
    let t1 = (box.max[axis]! - o[axis]!) / d[axis]!;
    if (t0 > t1) [t0, t1] = [t1, t0];
    near = Math.max(near, t0);
    far = Math.min(far, t1);
    if (near > far) return null;
  }
  if (far < 0) return null;
  // from inside the box, it is right here
  return Math.max(near, 0);
}

/** A player's box, feet at `at`, as a punch meets it. */
export function playerBox(at: Vec): Box {
  const half = HALF_WIDTH + HIT_MARGIN;
  return { min: [at.x - half, at.y - HIT_MARGIN, at.z - half], max: [at.x + half, at.y + BODY_HEIGHT + HIT_MARGIN, at.z + half] };
}

/** The box of a block cell. */
export function cellBox(cell: Vec): Box {
  return { min: [cell.x, cell.y, cell.z], max: [cell.x + 1, cell.y + 1, cell.z + 1] };
}

/** The nearest player the ray meets within `reach`, closer than `blockDistance` (the first block in the way). */
export function targetPlayer<T extends { position: Vec }>(
  origin: Vec, direction: Vec, players: Iterable<[string, T]>, blockDistance = Infinity, reach = ATTACK_REACH,
): string | null {
  let best: string | null = null;
  let bestDistance = Math.min(reach, blockDistance);
  for (const [id, player] of players) {
    const distance = rayBoxDistance(origin, direction, playerBox(player.position));
    if (distance !== null && distance <= bestDistance) {
      best = id;
      bestDistance = distance;
    }
  }
  return best;
}
