import { hashString, PLAZA_HEIGHT } from './playgroundWorld';

// The playground's one map: a small island of blocks in a calm sea. A flat
// plaza in the middle where people arrive, the big screen as a block wall at its
// north end, grass hills, a sand beach and a scatter of trees. Generated from a
// fixed seed, so every client builds the same island without sending it.
//
// Coordinates are blocks: the block (x, y, z) fills [x, x+1) × [y, y+1) × [z, z+1).

export const BLOCK = {
  air: 0, grass: 1, dirt: 2, stone: 3, sand: 4, log: 5, leaves: 6, frame: 7, planks: 8,
} as const;
export type Block = (typeof BLOCK)[keyof typeof BLOCK];

/** The island fits in a SIZE × SIZE square centred on the origin. */
export const SIZE = 72;
const HALF = SIZE / 2;
export const HEIGHT = 24;
/** Water fills every column whose ground is at or below this height. */
export const SEA_LEVEL = 4;
const PLAZA_RADIUS = 9.5;
const ISLAND_RADIUS = 28;
/** A block wall for the big screen, its front face at this z. */
export const SCREEN_WALL = { minX: -7, maxX: 7, z: -18, bottom: PLAZA_HEIGHT, top: PLAZA_HEIGHT + 8 } as const;

const SEED = 20261123;

/** Smooth value noise: hashed corners, eased in between. */
function valueNoise(x: number, z: number, scale: number, salt: number): number {
  const gx = x / scale;
  const gz = z / scale;
  const x0 = Math.floor(gx);
  const z0 = Math.floor(gz);
  const corner = (cx: number, cz: number) => (hashString(`${SEED}:${salt}:${cx}:${cz}`) % 10000) / 10000;
  const ease = (t: number) => t * t * (3 - 2 * t);
  const tx = ease(gx - x0);
  const tz = ease(gz - z0);
  const top = corner(x0, z0) * (1 - tx) + corner(x0 + 1, z0) * tx;
  const bottom = corner(x0, z0 + 1) * (1 - tx) + corner(x0 + 1, z0 + 1) * tx;
  return top * (1 - tz) + bottom * tz;
}

const inPlaza = (x: number, z: number) => Math.hypot(x + 0.5, z - 1.5) < PLAZA_RADIUS;
const inScreenLawn = (x: number, z: number) => x >= -10 && x < 10 && z >= -20 && z < -6;

function surfaceHeight(x: number, z: number): number {
  if (inPlaza(x, z) || inScreenLawn(x, z)) return PLAZA_HEIGHT;
  const r = Math.hypot(x + 0.5, z + 0.5) / ISLAND_RADIUS;
  const hills = valueNoise(x, z, 9, 1) * 4 + valueNoise(x, z, 4, 2) * 1.2;
  // the shore wanders, so the island is not a perfect circle
  const shore = (valueNoise(x, z, 12, 3) - 0.5) * 0.35;
  const falloff = Math.max(0, r - 0.55 + shore) * 14;
  // near the plaza the ground eases toward its height, so its edge is not a cliff
  const plazaPull = Math.max(0, 1 - (Math.hypot(x + 0.5, z - 1.5) - PLAZA_RADIUS) / 6);
  const wild = PLAZA_HEIGHT - 1 + hills - falloff;
  return Math.max(1, Math.round(wild * (1 - plazaPull) + PLAZA_HEIGHT * plazaPull));
}

export class IslandMap {
  private readonly blocks = new Uint8Array(SIZE * HEIGHT * SIZE);
  /** height of the ground (terrain, trunks, walls) in each column */
  private readonly ground = new Int8Array(SIZE * SIZE);

  constructor() {
    for (let x = -HALF; x < HALF; x++) {
      for (let z = -HALF; z < HALF; z++) {
        const h = surfaceHeight(x, z);
        const beach = h <= SEA_LEVEL + 1;
        for (let y = 0; y < h; y++) {
          const depth = h - 1 - y;
          const block = beach ? (depth < 3 ? BLOCK.sand : BLOCK.stone)
            : depth === 0 ? (inPlaza(x, z) ? BLOCK.planks : BLOCK.grass)
            : depth < 3 ? BLOCK.dirt : BLOCK.stone;
          this.set(x, y, z, block);
        }
      }
    }
    this.buildScreenWall();
    this.plantTrees();
    for (let x = -HALF; x < HALF; x++) {
      for (let z = -HALF; z < HALF; z++) {
        let y = 0;
        while (y < HEIGHT && this.solidForGround(this.get(x, y, z))) y++;
        this.ground[(x + HALF) * SIZE + (z + HALF)] = y;
      }
    }
  }

  get(x: number, y: number, z: number): Block {
    if (x < -HALF || x >= HALF || z < -HALF || z >= HALF || y < 0 || y >= HEIGHT) return BLOCK.air;
    return this.blocks[((x + HALF) * HEIGHT + y) * SIZE + (z + HALF)] as Block;
  }

  private set(x: number, y: number, z: number, block: Block): void {
    if (x < -HALF || x >= HALF || z < -HALF || z >= HALF || y < 0 || y >= HEIGHT) return;
    this.blocks[((x + HALF) * HEIGHT + y) * SIZE + (z + HALF)] = block;
  }

  private solidForGround(block: Block): boolean {
    return block !== BLOCK.air && block !== BLOCK.leaves;
  }

  /** Where someone standing in the column at (x, z) has their feet. */
  groundAt(x: number, z: number): number {
    const bx = Math.floor(x);
    const bz = Math.floor(z);
    if (bx < -HALF || bx >= HALF || bz < -HALF || bz >= HALF) return 0;
    return this.ground[(bx + HALF) * SIZE + (bz + HALF)]!;
  }

  /** Whether the cell (x, y, z) stops a body: any block (leaves too), the ground under the map, and
   * the sea and anything past the map's edge as a wall, since nobody swims (yet). */
  isSolid(x: number, y: number, z: number): boolean {
    if (y < 0) return true;
    if (x < -HALF || x >= HALF || z < -HALF || z >= HALF) return true;
    if (this.isWater(x + 0.5, z + 0.5)) return true;
    return this.get(x, y, z) !== BLOCK.air;
  }

  /** The sea: ground at or under the water line. Nobody swims (yet). */
  isWater(x: number, z: number): boolean {
    return this.groundAt(x, z) <= SEA_LEVEL;
  }

  forEachBlock(visit: (x: number, y: number, z: number, block: Block) => void): void {
    for (let x = -HALF; x < HALF; x++) {
      for (let y = 0; y < HEIGHT; y++) {
        for (let z = -HALF; z < HALF; z++) {
          const block = this.get(x, y, z);
          if (block !== BLOCK.air) visit(x, y, z, block);
        }
      }
    }
  }

  private buildScreenWall(): void {
    const { minX, maxX, z, bottom, top } = SCREEN_WALL;
    for (let x = minX; x < maxX; x++) for (let y = bottom; y < top; y++) this.set(x, y, z, BLOCK.frame);
  }

  private plantTrees(): void {
    let state = SEED;
    const rand = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
    const trees: [number, number][] = [];
    for (let attempt = 0; attempt < 400 && trees.length < 22; attempt++) {
      const x = Math.floor((rand() - 0.5) * (ISLAND_RADIUS * 1.7));
      const z = Math.floor((rand() - 0.5) * (ISLAND_RADIUS * 1.7));
      if (inPlaza(x, z) || inScreenLawn(x, z) || Math.hypot(x + 0.5, z - 1.5) < PLAZA_RADIUS + 2) continue;
      const h = surfaceHeight(x, z);
      if (h <= SEA_LEVEL + 1 || this.get(x, h - 1, z) !== BLOCK.grass) continue;
      if (trees.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < 5)) continue;
      trees.push([x, z]);
      const trunk = 4 + Math.floor(rand() * 2);
      for (let y = h; y < h + trunk; y++) this.set(x, y, z, BLOCK.log);
      const top = h + trunk;
      for (let dy = -2; dy <= 1; dy++) {
        const radius = dy < 0 ? 2 : 1;
        for (let dx = -radius; dx <= radius; dx++) {
          for (let dz = -radius; dz <= radius; dz++) {
            // round the corners off, a little differently on every tree
            if (Math.abs(dx) === radius && Math.abs(dz) === radius && (dy === 1 || rand() < 0.6)) continue;
            if (dx === 0 && dz === 0 && dy < 0) continue;
            if (this.get(x + dx, top + dy, z + dz) === BLOCK.air) this.set(x + dx, top + dy, z + dz, BLOCK.leaves);
          }
        }
      }
    }
  }
}
