import { BLOCK, type Block, type Facing } from './blocks.js';
import { BlockGrid } from './grid.js';
import { HALF, HEIGHT, PLAZA, PLAZA_HEIGHT, SCREEN_WALL, SEA_LEVEL, SIZE } from './layout.js';

// A new playground's world, laid out on purpose rather than left to chance: an
// island in a calm sea, the lobby in the middle (a grass plaza with the big
// screen's wall at its north end and a crafting table and a furnace at its
// edge), gravel paths from there to a stony mountain in the north-east with a
// cave into it, a lake in the south-east, a dense forest in the south-west and
// meadows with scattered trees between them, sandy beaches all round. Under the
// grass and dirt is stone down to a floor of bedrock, with ores the deeper the
// rarer (coal, iron, gold, diamonds) and a few winding caves.
//
// It is generated once, by the playground service, when a playground is first
// visited; from then on the world is the saved one, with everything its players
// changed (worlds.ts). The same seed always gives the same world.

/** Bumped when the generator changes, and stored with each world it made. */
export const GENERATOR_VERSION = 2;
const SEED = 20261124;

const ISLAND_RADIUS = 54;
const MOUNTAIN = { x: 28, z: -28, radius: 25, peak: 58 } as const;
const LAKE = { x: 22, z: 23, radius: 11, depth: 6 } as const;
const FOREST = { x: -26, z: 24, radius: 22 } as const;
/** the lawn in front of the big screen, as flat as the plaza */
const SCREEN_LAWN = { minX: -10, maxX: 10, minZ: -21, maxZ: -6 } as const;
/** the mountain's cave starts at its south-west foot, facing the plaza, and winds down into it under the
 * peak: x, z and how far under the ground's surface at the mouth (the first point is the mouth itself) */
const CAVE_PATH: readonly [number, number, number][] = [[13, -14, 0], [17, -18, 4], [21, -21, 9], [25, -25, 14], [28, -22, 18], [32, -25, 21]];
/** where the gravel paths run, from the plaza's edge */
const PATHS: readonly [number, number, number, number][] = [
  [7, -5, 12, -12], // to the cave
  [8, 8, 14, 15], // to the lake
  [-8, 8, -14, 14], // into the forest
  [-10, -2, -36, -10], // west, to the meadows and the beach
];
/** the lobby's workshop at the plaza's south-east edge */
const SHOP = { table: [8, 6], furnace: [6, 8], creativeChest: [8, 8] } as const;
/** the creative chest's front faces the plaza's middle */
const CREATIVE_CHEST_FACING: Facing = 1;

export type { Facing };

export interface GeneratedWorld {
  grid: BlockGrid;
  /** the furnaces it placed, and the way each faces */
  furnaces: { x: number; y: number; z: number; facing: Facing }[];
}

/** A number in [0, 1) for a point, the same every time (a mixed integer hash). */
function hash(a: number, b: number, c: number, salt: number): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1) ^ Math.imul(salt + SEED, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** Smooth value noise: hashed corners, eased in between. */
function noise(x: number, z: number, scale: number, salt: number): number {
  const gx = x / scale;
  const gz = z / scale;
  const x0 = Math.floor(gx);
  const z0 = Math.floor(gz);
  const ease = (t: number) => t * t * (3 - 2 * t);
  const tx = ease(gx - x0);
  const tz = ease(gz - z0);
  const top = hash(x0, z0, 0, salt) * (1 - tx) + hash(x0 + 1, z0, 0, salt) * tx;
  const bottom = hash(x0, z0 + 1, 0, salt) * (1 - tx) + hash(x0 + 1, z0 + 1, 0, salt) * tx;
  return top * (1 - tz) + bottom * tz;
}

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const smooth = (t: number) => { const c = Math.min(1, Math.max(0, t)); return c * c * (3 - 2 * c); };

function distanceToSegment(x: number, z: number, [ax, az, bx, bz]: readonly [number, number, number, number]): number {
  const dx = bx - ax;
  const dz = bz - az;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - (ax + dx * t), z - (az + dz * t));
}

const distanceTo = (x: number, z: number, at: { x: number; z: number }) => Math.hypot(x + 0.5 - at.x, z + 0.5 - at.z);
const inPlaza = (x: number, z: number): boolean => distanceTo(x, z, PLAZA) < PLAZA.radius;
const inLawn = (x: number, z: number) => x >= SCREEN_LAWN.minX && x < SCREEN_LAWN.maxX && z >= SCREEN_LAWN.minZ && z < SCREEN_LAWN.maxZ;
const onPath = (x: number, z: number) => PATHS.some((path) => distanceToSegment(x + 0.5, z + 0.5, path) < 1.3);

/** How many solid cells the column at (x, z) has: its top block is at this height minus one. */
function surfaceHeight(x: number, z: number): number {
  if (inPlaza(x, z) || inLawn(x, z)) return PLAZA_HEIGHT;
  const hills = noise(x, z, 14, 1) * 5 + noise(x, z, 6, 2) * 1.5 - 2.5;
  let height = PLAZA_HEIGHT + hills;

  // the mountain rises out of the hills, rougher toward its top
  const mountain = Math.max(0, 1 - distanceTo(x, z, MOUNTAIN) / MOUNTAIN.radius);
  if (mountain > 0) {
    const rough = (noise(x, z, 5, 3) - 0.5) * 6 * mountain;
    height += Math.pow(mountain, 1.5) * (MOUNTAIN.peak - PLAZA_HEIGHT) + rough;
  }

  // the lake: a bowl under the sea's level, its banks easing back up
  const lake = distanceTo(x, z, LAKE) + (noise(x, z, 5, 4) - 0.5) * 4;
  if (lake < LAKE.radius + 6) {
    const bottom = SEA_LEVEL - LAKE.depth * (1 - Math.pow(Math.min(1, lake / LAKE.radius), 2));
    const bank = smooth((lake - LAKE.radius + 1) / 7);
    height = bottom * (1 - bank) + height * bank;
  }

  // near the plaza the ground eases toward its height, so its edge is not a cliff
  const plazaPull = Math.max(0, 1 - (distanceTo(x, z, PLAZA) - PLAZA.radius) / 7);
  height = height * (1 - plazaPull) + PLAZA_HEIGHT * plazaPull;

  // the shore wanders, so the island is not a circle, and the land dives into the sea past it
  const shore = (noise(x, z, 16, 5) - 0.5) * 0.3;
  const r = Math.hypot(x + 0.5, z + 0.5) / ISLAND_RADIUS + shore;
  if (r > 0.78) {
    const seabed = SEA_LEVEL - 6 + noise(x, z, 8, 6) * 3;
    height = height + (seabed - height) * smooth((r - 0.78) / 0.3);
  }
  return Math.max(2, Math.min(HEIGHT - 8, Math.round(height)));
}

export function generateWorld(): GeneratedWorld {
  const grid = new BlockGrid();
  const heights = new Int16Array(SIZE * SIZE);
  const column = (x: number, z: number) => (x + HALF) * SIZE + (z + HALF);
  for (let x = -HALF; x < HALF; x++) for (let z = -HALF; z < HALF; z++) heights[column(x, z)] = surfaceHeight(x, z);
  const heightAt = (x: number, z: number) => heights[column(Math.max(-HALF, Math.min(HALF - 1, x)), Math.max(-HALF, Math.min(HALF - 1, z)))]!;

  for (let x = -HALF; x < HALF; x++) {
    for (let z = -HALF; z < HALF; z++) {
      const h = heightAt(x, z);
      const steep = Math.max(...[[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => Math.abs(heightAt(x + dx!, z + dz!) - h)));
      // sand where the sea or the lake meets the land
      const shoreline = h <= SEA_LEVEL + 1 || (h <= SEA_LEVEL + 2 && distanceTo(x, z, LAKE) < LAKE.radius + 3);
      const rocky = !shoreline && (h > 45 || (steep >= 3 && distanceTo(x, z, MOUNTAIN) < MOUNTAIN.radius));
      const path = !shoreline && !rocky && onPath(x, z) && !inPlaza(x, z);
      const gravelBed = h < SEA_LEVEL - 3 && noise(x, z, 6, 7) > 0.62;
      for (let y = 0; y < h; y++) {
        const depth = h - 1 - y;
        let block: Block;
        if (y === 0 || (y === 1 && hash(x, y, z, 8) < 0.5)) block = BLOCK.bedrock;
        else if (rocky) block = BLOCK.stone;
        else if (shoreline) block = depth < 3 ? (gravelBed ? BLOCK.gravel : BLOCK.sand) : BLOCK.stone;
        else if (depth === 0) block = path ? BLOCK.gravel : BLOCK.grass;
        else block = depth < 4 ? BLOCK.dirt : BLOCK.stone;
        grid.set(x, y, z, block);
      }
    }
  }

  const rand = random(SEED);
  placeOres(grid, rand);
  carveCaves(grid, heightAt, rand);
  for (let x = -HALF; x < HALF; x++) {
    for (let z = -HALF; z < HALF; z++) {
      for (let y = heightAt(x, z); y < SEA_LEVEL; y++) if (grid.get(x, y, z) === BLOCK.air) grid.set(x, y, z, BLOCK.water);
    }
  }
  plantTrees(grid, heightAt, rand);
  for (let x = SCREEN_WALL.minX; x < SCREEN_WALL.maxX; x++) for (let y = SCREEN_WALL.bottom; y < SCREEN_WALL.top; y++) grid.set(x, y, SCREEN_WALL.z, BLOCK.frame);
  grid.set(SHOP.table[0], PLAZA_HEIGHT, SHOP.table[1], BLOCK.craftingTable);
  grid.set(SHOP.furnace[0], PLAZA_HEIGHT, SHOP.furnace[1], BLOCK.furnace);
  placeCreativeChest(grid);
  // the furnace's front faces the plaza's middle
  return { grid, furnaces: [{ x: SHOP.furnace[0], y: PLAZA_HEIGHT, z: SHOP.furnace[1], facing: 2 }] };
}

interface Ore { block: Block; veins: number; size: [number, number]; maxY: number }
const ORES: Ore[] = [
  { block: BLOCK.coalOre, veins: 220, size: [5, 11], maxY: 56 },
  { block: BLOCK.ironOre, veins: 130, size: [4, 8], maxY: 40 },
  { block: BLOCK.goldOre, veins: 30, size: [3, 7], maxY: 22 },
  { block: BLOCK.diamondOre, veins: 14, size: [2, 5], maxY: 13 },
];

/** Veins of ore in the stone: a short random walk from a random cell, the deeper ores the rarer. */
/** Puts the creative chest by the crafting table and the furnace unless the world has one: new worlds get
 * it here, worlds made before it when they load. Whatever stood in its cell gives way. */
export function placeCreativeChest(grid: BlockGrid): boolean {
  if (grid.blocks.includes(BLOCK.creativeChest)) return false;
  grid.set(SHOP.creativeChest[0], PLAZA_HEIGHT, SHOP.creativeChest[1], BLOCK.creativeChest, CREATIVE_CHEST_FACING);
  return true;
}

function placeOres(grid: BlockGrid, rand: () => number): void {
  const steps = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const;
  for (const ore of ORES) {
    for (let vein = 0; vein < ore.veins; vein++) {
      let x = Math.floor((rand() - 0.5) * ISLAND_RADIUS * 2);
      let y = 2 + Math.floor(rand() * (ore.maxY - 2));
      let z = Math.floor((rand() - 0.5) * ISLAND_RADIUS * 2);
      const size = ore.size[0] + Math.floor(rand() * (ore.size[1] - ore.size[0] + 1));
      for (let i = 0; i < size; i++) {
        if (grid.get(x, y, z) === BLOCK.stone) grid.set(x, y, z, ore.block);
        const [dx, dy, dz] = steps[Math.floor(rand() * steps.length)]!;
        x += dx; y += dy; z += dz;
      }
    }
  }
}

/** Air in a ball, where it does not open the ground near the surface (unless `open`) or the sea. */
function carveBall(grid: BlockGrid, heightAt: (x: number, z: number) => number, cx: number, cy: number, cz: number, radius: number, open: boolean): void {
  const r = Math.ceil(radius);
  for (let x = Math.floor(cx) - r; x <= Math.floor(cx) + r; x++) {
    for (let z = Math.floor(cz) - r; z <= Math.floor(cz) + r; z++) {
      const h = heightAt(x, z);
      if (h <= SEA_LEVEL + 2 || inPlaza(x, z)) continue;
      for (let y = Math.max(2, Math.floor(cy) - r); y <= Math.floor(cy) + r; y++) {
        if (!open && y >= h - 4) continue;
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 + (z + 0.5 - cz) ** 2 > radius * radius) continue;
        const block = grid.get(x, y, z);
        if (block !== BLOCK.air && block !== BLOCK.bedrock && block !== BLOCK.water) grid.set(x, y, z, BLOCK.air);
      }
    }
  }
}

/** The mountain's cave (a tunnel along CAVE_PATH that opens at its foot) and worm caves deep under the island. */
function carveCaves(grid: BlockGrid, heightAt: (x: number, z: number) => number, rand: () => number): void {
  const [mouthX, mouthZ] = CAVE_PATH[0]!;
  // the tunnel's middle a block over the ground at the mouth, so its floor is the ground there
  const mouthY = heightAt(mouthX, mouthZ) + 1;
  const points = CAVE_PATH.map(([x, z, depth]) => [x, mouthY - depth, z] as const);
  for (let i = 0; i + 1 < points.length; i++) {
    const [ax, ay, az] = points[i]!;
    const [bx, by, bz] = points[i + 1]!;
    const length = Math.hypot(bx - ax, by - ay, bz - az);
    for (let t = 0; t <= length; t += 0.5) {
      const f = t / length;
      carveBall(grid, heightAt, ax + (bx - ax) * f, ay + (by - ay) * f, az + (bz - az) * f, 1.8 + (i === points.length - 2 ? f * 1.5 : 0), true);
    }
  }
  for (let worm = 0; worm < 9; worm++) {
    let x = (rand() - 0.5) * ISLAND_RADIUS * 1.4;
    let y = 6 + rand() * 14;
    let z = (rand() - 0.5) * ISLAND_RADIUS * 1.4;
    let yaw = rand() * Math.PI * 2;
    let pitch = 0;
    const length = 40 + Math.floor(rand() * 50);
    for (let step = 0; step < length; step++) {
      carveBall(grid, heightAt, x, y, z, 1.3 + Math.sin((step / length) * Math.PI) * 1.2, false);
      yaw += (rand() - 0.5) * 0.6;
      pitch = Math.max(-0.5, Math.min(0.5, pitch * 0.8 + (rand() - 0.5) * 0.3));
      x += Math.cos(yaw) * Math.cos(pitch);
      z += Math.sin(yaw) * Math.cos(pitch);
      y = Math.max(4, Math.min(28, y + Math.sin(pitch)));
    }
  }
}

function plantTree(grid: BlockGrid, x: number, ground: number, z: number, trunk: number, rand: () => number): void {
  for (let y = ground; y < ground + trunk; y++) grid.set(x, y, z, BLOCK.log);
  const top = ground + trunk;
  for (let dy = -2; dy <= 1; dy++) {
    const radius = dy < 0 ? 2 : 1;
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        // round the corners off, a little differently on every tree
        if (Math.abs(dx) === radius && Math.abs(dz) === radius && (dy === 1 || rand() < 0.6)) continue;
        if (dx === 0 && dz === 0 && dy < 0) continue;
        if (grid.get(x + dx, top + dy, z + dz) === BLOCK.air) grid.set(x + dx, top + dy, z + dz, BLOCK.leaves);
      }
    }
  }
}

/** Oaks: close together in the forest, scattered over the meadows and the mountain's lower slopes. */
function plantTrees(grid: BlockGrid, heightAt: (x: number, z: number) => number, rand: () => number): void {
  const trees: [number, number][] = [];
  for (let attempt = 0; attempt < 6000 && trees.length < 260; attempt++) {
    const x = Math.floor((rand() - 0.5) * ISLAND_RADIUS * 2);
    const z = Math.floor((rand() - 0.5) * ISLAND_RADIUS * 2);
    const forest = distanceTo(x, z, FOREST) < FOREST.radius - (noise(x, z, 6, 9) - 0.5) * 8;
    const spacing = forest ? 3.2 : 7;
    if (!forest && rand() > 0.35) continue;
    if (inLawn(x, z) || distanceTo(x, z, PLAZA) < PLAZA.radius + 2 || onPath(x, z) || distanceTo(x, z, LAKE) < LAKE.radius + 2) continue;
    const ground = heightAt(x, z);
    if (grid.get(x, ground - 1, z) !== BLOCK.grass || ground > HEIGHT - 10) continue;
    if (trees.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < spacing)) continue;
    trees.push([x, z]);
    plantTree(grid, x, ground, z, 4 + Math.floor(rand() * (forest ? 3 : 2)), rand);
  }
}
