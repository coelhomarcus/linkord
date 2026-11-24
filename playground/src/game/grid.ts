import { BLOCK, BLOCK_COUNT, blockDef, type Block } from './blocks.js';
import { HALF, HEIGHT, SIZE } from './layout.js';

// A world's blocks, one byte a cell, in horizontal layers from the bottom up
// (so a stored world, mostly whole layers of stone, then of air, compresses
// well). The service keeps the one that counts; every browser in the call keeps
// a copy it got from there and the changes since.

export const CELL_COUNT = SIZE * SIZE * HEIGHT;

export class BlockGrid {
  readonly blocks: Uint8Array;

  constructor(blocks: Uint8Array = new Uint8Array(CELL_COUNT)) {
    if (blocks.length !== CELL_COUNT) throw new Error(`a world has ${CELL_COUNT} cells, not ${blocks.length}`);
    this.blocks = blocks;
  }

  /** A grid from stored bytes, with anything this version does not know as air. */
  static from(bytes: Uint8Array): BlockGrid {
    const blocks = new Uint8Array(bytes);
    for (let i = 0; i < blocks.length; i++) if (blocks[i]! >= BLOCK_COUNT) blocks[i] = BLOCK.air;
    return new BlockGrid(blocks);
  }

  static inside(x: number, y: number, z: number): boolean {
    return x >= -HALF && x < HALF && z >= -HALF && z < HALF && y >= 0 && y < HEIGHT;
  }

  static index(x: number, y: number, z: number): number {
    return (y * SIZE + (x + HALF)) * SIZE + (z + HALF);
  }

  get(x: number, y: number, z: number): Block {
    if (!BlockGrid.inside(x, y, z)) return BLOCK.air;
    return this.blocks[BlockGrid.index(x, y, z)] as Block;
  }

  set(x: number, y: number, z: number, block: Block): void {
    if (BlockGrid.inside(x, y, z)) this.blocks[BlockGrid.index(x, y, z)] = block;
  }

  /** Whether the cell stops a body: a solid block, the ground under the world, and its edge as a wall. */
  isSolid(x: number, y: number, z: number): boolean {
    if (y < 0) return true;
    if (x < -HALF || x >= HALF || z < -HALF || z >= HALF) return true;
    return blockDef(this.get(x, y, z)).solid;
  }

  isWater(x: number, y: number, z: number): boolean {
    return this.get(x, y, z) === BLOCK.water;
  }

  /** Where someone standing in the column at (x, z) has their feet: on its highest solid block. */
  groundAt(x: number, z: number): number {
    const bx = Math.floor(x);
    const bz = Math.floor(z);
    for (let y = HEIGHT - 1; y >= 0; y--) if (blockDef(this.get(bx, y, bz)).solid) return y + 1;
    return 0;
  }
}
