import { describe, expect, it } from 'vitest';
import { BLOCK, BLOCK_COUNT, LOG_AXIS } from '@game/blocks';
import type { Block } from '@game/blocks';
import { faceTile, faceTurned, frameSeconds } from '@/features/playground/engine/blockTextures';

type Drawn = Exclude<Block, 0 | 15>;

describe('block tiles', () => {
  it('gives every block a tile of its own, not the stand-in for a missing one', () => {
    for (let block = 1; block < BLOCK_COUNT; block++) {
      if (block === BLOCK.water || block === BLOCK.stone) continue;
      expect(faceTile(block as Drawn, 2), `block ${block}`).not.toBe('stone');
    }
    expect(faceTile(BLOCK.lightBlueWool, 0)).toBe('light_blue_wool');
    expect(faceTile(BLOCK.terracotta, 3)).toBe('terracotta');
  });

  it('shows a lying log\'s rings at its ends and turns its bark along it', () => {
    // standing: rings on top and bottom
    expect(faceTile(BLOCK.log, 2)).toBe('logTop');
    expect(faceTile(BLOCK.log, 0)).toBe('logSide');
    // along x: rings on ±x, bark turned everywhere else
    expect(faceTile(BLOCK.log, 0, undefined, LOG_AXIS.x)).toBe('logTop');
    expect(faceTile(BLOCK.log, 2, undefined, LOG_AXIS.x)).toBe('logSide');
    expect(faceTurned(BLOCK.log, 2, LOG_AXIS.x)).toBe(true);
    expect(faceTurned(BLOCK.log, 4, LOG_AXIS.x)).toBe(true);
    // along z: rings on ±z, the top's bark already runs along z
    expect(faceTile(BLOCK.log, 5, undefined, LOG_AXIS.z)).toBe('logTop');
    expect(faceTurned(BLOCK.log, 0, LOG_AXIS.z)).toBe(true);
    expect(faceTurned(BLOCK.log, 2, LOG_AXIS.z)).toBe(false);
    expect(faceTurned(BLOCK.stone, 0, 0)).toBe(false);
  });
});

describe('animated textures', () => {
  it('reads a frame\'s time from its .mcmeta, in ticks of a twentieth of a second', () => {
    expect(frameSeconds('{"animation":{"frametime":8}}')).toBeCloseTo(0.4);
    expect(frameSeconds('{"animation":{}}')).toBeCloseTo(0.05);
    expect(frameSeconds('not json')).toBeCloseTo(0.05);
  });
});
