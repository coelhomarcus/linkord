import { blockDef, type Block } from './blocks.js';
import { BlockGrid, CELL_COUNT } from './grid.js';
import { HALF, HEIGHT, SCREEN } from './layout.js';

// The light in every cell of a world, in two channels as the block game keeps
// it, each 0..15. Sky light falls straight down from the open sky at full
// strength, leaves and water dim it a step or two each, and it spreads sideways
// losing a step per block, so the ground under a tree, in a cave or under water
// is darker. Block light starts at each torch, lantern or glowstone (blocks.ts
// `light`) and spreads the same way in every direction. A change relights only
// the cells it can reach. Nothing of it is stored: it all follows from the
// blocks, so the service (where monsters may appear) and every browser (which
// draws it, web/src/features/playground/engine/lighting.ts) agree. A third
// channel, ScreenLight, is the big screen's glow: only browsers draw it.
//
// The rules are minecraft-renderer's (github.com/zardoy/minecraft-web-client,
// MIT, Copyright (c) 2020 PrismarineJS) and the game's.

export const MAX_LIGHT = 15;
/** light reaches at most this far from where a block changed */
const REACH = MAX_LIGHT + 1;

/** What the light needs to know of the world. */
export interface LightGrid {
  get(x: number, y: number, z: number): Block;
}

/** The cells whose light changed: a box, inclusive. */
export interface LightChange { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }

const NEIGHBOURS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const;

/** A box of cells, clamped to the world. */
interface Box { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }

function clampBox(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Box {
  return {
    x0: Math.max(-HALF, x0), x1: Math.min(HALF - 1, x1),
    y0: Math.max(0, y0), y1: Math.min(HEIGHT - 1, y1),
    z0: Math.max(-HALF, z0), z1: Math.min(HALF - 1, z1),
  };
}

const inBox = (box: Box, x: number, y: number, z: number) =>
  x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1 && z >= box.z0 && z <= box.z1;

/** One channel's levels, and the work both channels share. */
abstract class LightChannel {
  protected readonly levels = new Uint8Array(CELL_COUNT);
  protected readonly grid: LightGrid;

  constructor(grid: LightGrid) {
    this.grid = grid;
  }

  /** The light in the cell (x, y, z), inside the world. */
  protected level(x: number, y: number, z: number): number {
    return this.levels[BlockGrid.index(x, y, z)]!;
  }

  /** The levels of a box, to see afterwards which changed. */
  protected snapshot(box: Box): Uint8Array {
    const before = new Uint8Array((box.x1 - box.x0 + 1) * (box.y1 - box.y0 + 1) * (box.z1 - box.z0 + 1));
    let i = 0;
    for (let x = box.x0; x <= box.x1; x++) for (let y = box.y0; y <= box.y1; y++) for (let z = box.z0; z <= box.z1; z++) before[i++] = this.level(x, y, z);
    return before;
  }

  /** Cells of the box's rim, just outside it, that hold light that flows in, pushed onto `queue`. */
  protected rimInto(box: Box, queue: number[]): void {
    for (let x = box.x0 - 1; x <= box.x1 + 1; x++) {
      for (let y = box.y0 - 1; y <= box.y1 + 1; y++) {
        for (let z = box.z0 - 1; z <= box.z1 + 1; z++) {
          if (inBox(box, x, y, z) || !BlockGrid.inside(x, y, z)) continue;
          // only the cells beside a face of the box: corners and edges touch nothing in it
          const outside = Number(x < box.x0 || x > box.x1) + Number(y < box.y0 || y > box.y1) + Number(z < box.z0 || z > box.z1);
          if (outside !== 1) continue;
          const index = BlockGrid.index(x, y, z);
          if (this.levels[index]! > 1) queue.push(index);
        }
      }
    }
  }

  /** Spreads the queued cells' light through the box every way, a step lost per block and the block's
   * own opacity on top (the sky's undimmed fall straight down is already in its columns). */
  protected spread(box: Box, queue: number[]): void {
    for (let head = 0; head < queue.length; head++) {
      const index = queue[head]!;
      const [x, y, z] = BlockGrid.cell(index);
      const level = this.levels[index]!;
      for (const [dx, dy, dz] of NEIGHBOURS) {
        const nx = x + dx;
        const ny = y + dy;
        const nz = z + dz;
        if (!inBox(box, nx, ny, nz)) continue;
        const next = level - 1 - blockDef(this.grid.get(nx, ny, nz)).lightOpacity;
        const target = BlockGrid.index(nx, ny, nz);
        if (next <= this.levels[target]!) continue;
        this.levels[target] = next;
        if (next > 1) queue.push(target);
      }
    }
  }

  /** The box around the cells whose level is not what `before` (a snapshot of the box) says, or null. */
  protected changed(box: Box, before: Uint8Array): LightChange | null {
    let change: LightChange | null = null;
    let i = 0;
    for (let x = box.x0; x <= box.x1; x++) {
      for (let y = box.y0; y <= box.y1; y++) {
        for (let z = box.z0; z <= box.z1; z++) {
          if (before[i++] === this.level(x, y, z)) continue;
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

/** Sky light in every cell of the world, 0..15, as the original propagates it. */
export class SkyLight extends LightChannel {
  constructor(grid: LightGrid) {
    super(grid);
    this.relight(clampBox(-HALF, HALF - 1, 0, HEIGHT - 1, -HALF, HALF - 1));
  }

  /** The sky light in the cell (x, y, z); open sky outside the world and above it, dark under it. */
  at(x: number, y: number, z: number): number {
    if (y < 0) return 0;
    if (!BlockGrid.inside(x, y, z)) return MAX_LIGHT;
    return this.level(x, y, z);
  }

  /** The light again after the block at (x, y, z) changed; the box of cells whose light changed, or null. */
  update(x: number, z: number): LightChange | null {
    // whole columns: a block changed anywhere in one moves the light all the way down it
    const box = clampBox(x - REACH, x + REACH, 0, HEIGHT - 1, z - REACH, z + REACH);
    const before = this.snapshot(box);
    this.relight(box);
    return this.changed(box, before);
  }

  /** Works the light out again in the box's columns, from the sky above them and the light of the cells
   * around them (which a change inside cannot reach, so they keep theirs). */
  private relight(box: Box): void {
    const queue: number[] = [];
    for (let x = box.x0; x <= box.x1; x++) {
      for (let z = box.z0; z <= box.z1; z++) {
        // straight down from the sky: undimmed through air, a step less through leaves or water
        let level = MAX_LIGHT;
        for (let y = HEIGHT - 1; y >= 0; y--) {
          const index = BlockGrid.index(x, y, z);
          level = level > 0 ? level - blockDef(this.grid.get(x, y, z)).lightOpacity : 0;
          this.levels[index] = Math.max(0, level);
          if (level > 1) queue.push(index);
        }
      }
    }
    this.rimInto(box, queue);
    this.spread(box, queue);
  }
}

/** Block light in every cell of the world, 0..15: what torches, lanterns and glowstone give off. */
export class BlockLight extends LightChannel {
  constructor(grid: LightGrid) {
    super(grid);
    this.relight(clampBox(-HALF, HALF - 1, 0, HEIGHT - 1, -HALF, HALF - 1));
  }

  /** The block light in the cell (x, y, z); none outside the world. */
  at(x: number, y: number, z: number): number {
    if (!BlockGrid.inside(x, y, z)) return 0;
    return this.level(x, y, z);
  }

  /** The light again after the block at (x, y, z) changed; the box of cells whose light changed, or null. */
  update(x: number, y: number, z: number): LightChange | null {
    const box = clampBox(x - REACH, x + REACH, y - REACH, y + REACH, z - REACH, z + REACH);
    const before = this.snapshot(box);
    this.relight(box);
    return this.changed(box, before);
  }

  /** Works the light out again in the box from the sources in it and the light of the cells around it,
   * which a change inside cannot reach (it is more than 15 blocks off), so they keep theirs. */
  private relight(box: Box): void {
    const queue: number[] = [];
    for (let x = box.x0; x <= box.x1; x++) {
      for (let y = box.y0; y <= box.y1; y++) {
        for (let z = box.z0; z <= box.z1; z++) {
          const index = BlockGrid.index(x, y, z);
          const light = blockDef(this.grid.get(x, y, z)).light;
          this.levels[index] = light;
          if (light > 1) queue.push(index);
        }
      }
    }
    this.rimInto(box, queue);
    this.spread(box, queue);
  }
}

/** The cells just in front of the big screen's picture, where its glow starts: a box, inclusive. */
export const SCREEN_LIGHT_CELLS = {
  minX: Math.floor(SCREEN.x - SCREEN.width / 2), maxX: Math.ceil(SCREEN.x + SCREEN.width / 2) - 1,
  minY: Math.floor(SCREEN.y - SCREEN.height / 2), maxY: Math.ceil(SCREEN.y + SCREEN.height / 2) - 1,
  z: Math.floor(SCREEN.z),
} as const;

const inScreenCells = (x: number, y: number, z: number) =>
  z === SCREEN_LIGHT_CELLS.z && x >= SCREEN_LIGHT_CELLS.minX && x <= SCREEN_LIGHT_CELLS.maxX && y >= SCREEN_LIGHT_CELLS.minY && y <= SCREEN_LIGHT_CELLS.maxY;

/** How far the big screen reaches, 0..15 in every cell, spread as block light is from the cells in front
 * of its picture: walls cast its shadow, and a block put right in front of it covers it. Only where the
 * light gets to; its colour is what is on the screen, which the browser keeps apart (engine/screenGlow.ts)
 * so a new colour never relights anything. */
export class ScreenLight extends LightChannel {
  constructor(grid: LightGrid) {
    super(grid);
    const c = SCREEN_LIGHT_CELLS;
    this.relight(clampBox(c.minX - REACH, c.maxX + REACH, c.minY - REACH, c.maxY + REACH, c.z - REACH, c.z + REACH));
  }

  /** The screen's light in the cell (x, y, z); none outside the world. */
  at(x: number, y: number, z: number): number {
    if (!BlockGrid.inside(x, y, z)) return 0;
    return this.level(x, y, z);
  }

  /** The light again after the block at (x, y, z) changed; the box of cells whose light changed, or null. */
  update(x: number, y: number, z: number): LightChange | null {
    const c = SCREEN_LIGHT_CELLS;
    // nothing changes beyond the light's reach of the screen
    if (x < c.minX - REACH || x > c.maxX + REACH || y < c.minY - REACH || y > c.maxY + REACH || Math.abs(z - c.z) > REACH) return null;
    const box = clampBox(x - REACH, x + REACH, y - REACH, y + REACH, z - REACH, z + REACH);
    const before = this.snapshot(box);
    this.relight(box);
    return this.changed(box, before);
  }

  /** Works the light out again in the box from the screen's cells in it (less what a block there lets
   * through) and the light of the cells around it. */
  private relight(box: Box): void {
    const queue: number[] = [];
    for (let x = box.x0; x <= box.x1; x++) {
      for (let y = box.y0; y <= box.y1; y++) {
        for (let z = box.z0; z <= box.z1; z++) {
          const index = BlockGrid.index(x, y, z);
          const light = inScreenCells(x, y, z) ? Math.max(0, MAX_LIGHT - blockDef(this.grid.get(x, y, z)).lightOpacity) : 0;
          this.levels[index] = light;
          if (light > 1) queue.push(index);
        }
      }
    }
    this.rimInto(box, queue);
    this.spread(box, queue);
  }
}
