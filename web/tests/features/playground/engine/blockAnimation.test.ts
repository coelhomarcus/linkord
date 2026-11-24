import { describe, expect, it } from 'vitest';
import { BLOCK, TORCH_ON_FLOOR, TORCH_ON_WALL } from '@game/blocks';
import type { Block } from '@game/blocks';
import { animateBlocks, torchFlame } from '@/features/playground/engine/blockAnimation';

describe('block animation', () => {
  it('puts a floor torch\'s flame over its stick, a wall torch\'s out from its wall', () => {
    expect(torchFlame(TORCH_ON_FLOOR)).toEqual([0.5, 0.7, 0.5]);
    // pointing -x, on the wall at +x: the flame is nearer that wall's side, as the tilted model's
    const [x, y, z] = torchFlame(TORCH_ON_WALL + 1);
    expect(x).toBeCloseTo(0.77);
    expect(y).toBeGreaterThan(0.7);
    expect(z).toBe(0.5);
    expect(torchFlame(TORCH_ON_WALL + 0)[2]).toBeCloseTo(0.23);
  });

  it('tells of the torches among the cells it picks, with their state, and of nothing else', () => {
    const torches = new Map([['1,0,0', TORCH_ON_WALL + 3], ['0,0,1', TORCH_ON_FLOOR]]);
    const grid = {
      get: (x: number, y: number, z: number): Block => (torches.has(`${x},${y},${z}`) ? BLOCK.torch : x === 0 && z === 0 ? BLOCK.stone : BLOCK.air),
      stateAt: (x: number, y: number, z: number) => torches.get(`${x},${y},${z}`) ?? 0,
    };
    const seen = new Map<string, number>();
    // picks of the near pass, two numbers an axis: (1, 0, 0), then (0, 0, 1), then the middle (stone)
    const step = 1.5 / 16;
    const numbers = [step, 0, 0, 0, 0, 0, 0, 0, 0, 0, step, 0, 0, 0, 0, 0, 0, 0];
    let calls = 0;
    animateBlocks(grid, 0, 0, 0, (x, y, z, state) => seen.set(`${x},${y},${z}`, state), () => numbers[calls++ % numbers.length]!);
    expect(Object.fromEntries(seen)).toEqual({ '1,0,0': TORCH_ON_WALL + 3, '0,0,1': TORCH_ON_FLOOR });
  });

  it('picks cells nearer the player more often, as many as the game does', () => {
    const picked: number[] = [];
    const grid = {
      get: (x: number, y: number, z: number): Block => { picked.push(Math.max(Math.abs(x), Math.abs(y), Math.abs(z))); return BLOCK.air; },
      stateAt: () => 0,
    };
    animateBlocks(grid, 0, 0, 0, () => {});
    expect(picked).toHaveLength(667 * 2);
    expect(Math.max(...picked)).toBeLessThanOrEqual(31);
    // per cell: the 17³ cells round the player against the 63³ - 33³ more than 16 blocks off
    const near = picked.filter((d) => d <= 8).length / 17 ** 3;
    const far = picked.filter((d) => d > 16).length / (63 ** 3 - 33 ** 3);
    expect(near).toBeGreaterThan(far * 10);
  });
});
