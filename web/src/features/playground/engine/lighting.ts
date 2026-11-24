import { BLOCK, HEIGHT, SIZE } from '../islandMap';
import type { Block } from '../islandMap';

// How bright each corner of a block face is, the block game's way: sky light
// falls straight down from the open sky at full strength, leaves dim it a step
// each, and it spreads sideways losing a step per block, so the ground under
// a tree or an overhang is darker; then every corner of a face averages the
// light of the cells around it (smooth lighting) and darkens where blocks meet
// (ambient occlusion), and each direction has its fixed shade.
//
// The rules and constants are minecraft-renderer's mesher (vertexShading.ts and
// models.ts in github.com/zardoy/minecraft-web-client, MIT, Copyright (c) 2020
// PrismarineJS), with its default lightmap.

export const MAX_LIGHT = 15;
const HALF = SIZE / 2;

/** What the light needs to know of the world. */
export interface BlockGrid {
  get(x: number, y: number, z: number): Block;
}

/** Air lets light through, leaves take a step off it, everything else stops it. */
function opacity(block: Block): number {
  if (block === BLOCK.air) return 0;
  if (block === BLOCK.leaves) return 1;
  return MAX_LIGHT;
}

/** Sky light in every cell of the map, 0..15, as the original propagates it. */
export class SkyLight {
  private readonly levels = new Uint8Array(SIZE * HEIGHT * SIZE);

  constructor(grid: BlockGrid) {
    const queue: number[] = [];
    // straight down from the sky: undimmed through air, a step less per leaf, stopped by anything solid
    for (let x = -HALF; x < HALF; x++) {
      for (let z = -HALF; z < HALF; z++) {
        let level = MAX_LIGHT;
        for (let y = HEIGHT - 1; y >= 0 && level > 0; y--) {
          level -= opacity(grid.get(x, y, z));
          if (level <= 0) break;
          this.levels[this.index(x, y, z)] = level;
          queue.push(x, y, z);
        }
      }
    }
    // then sideways and down, a step lost per block (and the leaf's own step on top)
    const neighbours = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const;
    for (let head = 0; head < queue.length; head += 3) {
      const x = queue[head]!;
      const y = queue[head + 1]!;
      const z = queue[head + 2]!;
      const level = this.levels[this.index(x, y, z)]!;
      if (level <= 1) continue;
      for (const [dx, dy, dz] of neighbours) {
        const nx = x + dx;
        const ny = y + dy;
        const nz = z + dz;
        if (!this.inside(nx, ny, nz)) continue;
        const next = level - 1 - opacity(grid.get(nx, ny, nz));
        const index = this.index(nx, ny, nz);
        if (next <= this.levels[index]!) continue;
        this.levels[index] = next;
        queue.push(nx, ny, nz);
      }
    }
  }

  /** The sky light in the cell (x, y, z); open sky outside the map, dark under it. */
  at(x: number, y: number, z: number): number {
    if (y < 0) return 0;
    if (!this.inside(x, y, z)) return MAX_LIGHT;
    return this.levels[this.index(x, y, z)]!;
  }

  private inside(x: number, y: number, z: number): boolean {
    return x >= -HALF && x < HALF && z >= -HALF && z < HALF && y >= 0 && y < HEIGHT;
  }

  private index(x: number, y: number, z: number): number {
    return ((x + HALF) * HEIGHT + y) * SIZE + (z + HALF);
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
