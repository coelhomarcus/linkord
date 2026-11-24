import { blockDef } from '@game/blocks';
import type { Block } from '@game/blocks';
import { BlockGrid, CELL_COUNT } from '@game/grid';
import { HALF, HEIGHT, SIZE } from '@game/layout';

// How bright each corner of a block face is, the block game's way: sky light
// falls straight down from the open sky at full strength, leaves and water dim
// it a step or two each, and it spreads sideways losing a step per block, so
// the ground under a tree, in a cave or under water is darker; then every
// corner of a face averages the light of the cells around it (smooth lighting)
// and darkens where blocks meet (ambient occlusion), and each direction has its
// fixed shade.
//
// The rules and constants are minecraft-renderer's mesher (vertexShading.ts and
// models.ts in github.com/zardoy/minecraft-web-client, MIT, Copyright (c) 2020
// PrismarineJS), with its default lightmap.

export const MAX_LIGHT = 15;
/** light reaches at most this far from where a block changed */
const REACH = MAX_LIGHT + 1;
const LAYER = SIZE * SIZE;

/** What the light needs to know of the world. */
export interface LightGrid {
  get(x: number, y: number, z: number): Block;
}

/** The cells whose light changed: a box, inclusive. */
export interface LightChange { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }

const NEIGHBOURS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const;

/** Sky light in every cell of the world, 0..15, as the original propagates it. */
export class SkyLight {
  private readonly levels = new Uint8Array(CELL_COUNT);
  private readonly grid: LightGrid;

  constructor(grid: LightGrid) {
    this.grid = grid;
    this.relight(-HALF, HALF - 1, -HALF, HALF - 1, false);
  }

  /** The sky light in the cell (x, y, z); open sky outside the world and above it, dark under it. */
  at(x: number, y: number, z: number): number {
    if (y < 0) return 0;
    if (!BlockGrid.inside(x, y, z)) return MAX_LIGHT;
    return this.levels[BlockGrid.index(x, y, z)]!;
  }

  /** The light again after the block at (x, y, z) changed; the box of cells whose light changed, or null. */
  update(x: number, z: number): LightChange | null {
    return this.relight(x - REACH, x + REACH, z - REACH, z + REACH, true);
  }

  /** Works the light out again in the columns x0..x1 × z0..z1, from the sky above them and the light of
   * the cells around them (which a change inside cannot reach, so they keep theirs). `compare` says
   * which cells changed (the first time, all of them did). */
  private relight(x0: number, x1: number, z0: number, z1: number, compare: boolean): LightChange | null {
    x0 = Math.max(-HALF, x0); x1 = Math.min(HALF - 1, x1);
    z0 = Math.max(-HALF, z0); z1 = Math.min(HALF - 1, z1);
    const before = compare ? new Uint8Array((x1 - x0 + 1) * HEIGHT * (z1 - z0 + 1)) : null;
    const local = (x: number, y: number, z: number) => ((x - x0) * HEIGHT + y) * (z1 - z0 + 1) + (z - z0);
    const queue: number[] = [];
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        // straight down from the sky: undimmed through air, a step less through leaves or water
        let level = MAX_LIGHT;
        for (let y = HEIGHT - 1; y >= 0; y--) {
          const index = BlockGrid.index(x, y, z);
          if (before) before[local(x, y, z)] = this.levels[index]!;
          level = level > 0 ? level - blockDef(this.grid.get(x, y, z)).lightOpacity : 0;
          this.levels[index] = Math.max(0, level);
          if (level > 1) queue.push(index);
        }
      }
    }
    // the light of the cells around the area flows in too
    for (let x = x0 - 1; x <= x1 + 1; x++) {
      for (let z = z0 - 1; z <= z1 + 1; z++) {
        if (x >= x0 && x <= x1 && z >= z0 && z <= z1) continue;
        if (!BlockGrid.inside(x, 0, z)) continue;
        for (let y = 0; y < HEIGHT; y++) {
          const index = BlockGrid.index(x, y, z);
          if (this.levels[index]! > 1) queue.push(index);
        }
      }
    }
    // then sideways and down, a step lost per block (and the block's own opacity on top)
    for (let head = 0; head < queue.length; head++) {
      const index = queue[head]!;
      const y = Math.floor(index / LAYER);
      const x = Math.floor((index % LAYER) / SIZE) - HALF;
      const z = (index % SIZE) - HALF;
      const level = this.levels[index]!;
      for (const [dx, dy, dz] of NEIGHBOURS) {
        const nx = x + dx;
        const ny = y + dy;
        const nz = z + dz;
        if (nx < x0 || nx > x1 || nz < z0 || nz > z1 || ny < 0 || ny >= HEIGHT) continue;
        const next = level - 1 - blockDef(this.grid.get(nx, ny, nz)).lightOpacity;
        const target = BlockGrid.index(nx, ny, nz);
        if (next <= this.levels[target]!) continue;
        this.levels[target] = next;
        if (next > 1) queue.push(target);
      }
    }
    if (!before) return null;
    let change: LightChange | null = null;
    for (let x = x0; x <= x1; x++) {
      for (let y = 0; y < HEIGHT; y++) {
        for (let z = z0; z <= z1; z++) {
          if (before[local(x, y, z)] === this.levels[BlockGrid.index(x, y, z)]) continue;
          if (!change) change = { minX: x, maxX: x, minY: y, maxY: y, minZ: z, maxZ: z };
          change.minX = Math.min(change.minX, x); change.maxX = Math.max(change.maxX, x);
          change.minY = Math.min(change.minY, y); change.maxY = Math.max(change.maxY, y);
          change.minZ = Math.min(change.minZ, z); change.maxZ = Math.max(change.maxZ, z);
        }
      }
    }
    return change;
  }
}

const MIN_BRIGHTNESS = 0.12;

/** The default lightmap: a light level (0..1) to a brightness, never fully black. */
export function lightmap(level: number): number {
  return MIN_BRIGHTNESS + level * (1 - MIN_BRIGHTNESS);
}

/** The fixed shade of a face by the way it points: tops full, bottoms half, east/west dimmest. */
export function sideShade(dx: number, dy: number, dz: number): number {
  return 0.75 + 0.25 * dy + 0.05 * (Math.abs(dz) - 3 * Math.abs(dx));
}

/** Ambient occlusion of a face corner, 0 (both sides blocked) to 3 (open). */
export function cornerOcclusion(side1: boolean, side2: boolean, corner: boolean): number {
  if (side1 && side2) return 0;
  return 3 - Number(side1) - Number(side2) - Number(corner);
}

/** How bright one corner of a face is: its shade, its occlusion and the light around it. */
export function cornerBrightness(shade: number, occlusion: number, light: number): number {
  return shade * (occlusion * 0.2 + 0.4) * lightmap(light / MAX_LIGHT);
}
