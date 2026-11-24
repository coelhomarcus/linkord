import { describe, expect, it } from 'vitest';
import { BLOCK } from '@game/blocks';
import type { Block } from '@game/blocks';
import { HEIGHT } from '@game/layout';
import { cornerBrightness, cornerOcclusion, lightmap, MAX_LIGHT, sideShade, SkyLight } from '@/features/playground/engine/lighting';

/** flat stone up to y = 4, a stone roof over x 0..2 at y = 8 (but where `holes` says), a leaf block over
 * x = 10 at y = 8 */
const holes = new Set<string>();
const grid = {
  get(x: number, y: number, z: number): Block {
    if (y < 0 || y >= HEIGHT) return BLOCK.air;
    if (y < 5) return BLOCK.stone;
    if (y === 8 && x >= 0 && x <= 2 && z >= 0 && z <= 2 && !holes.has(`${x},${z}`)) return BLOCK.stone;
    if (y === 8 && x === 10 && z === 0) return BLOCK.leaves;
    return BLOCK.air;
  },
};

describe('SkyLight', () => {
  const sky = new SkyLight(grid);

  it('is full under the open sky and dark inside the ground', () => {
    expect(sky.at(-20, 5, -20)).toBe(MAX_LIGHT);
    expect(sky.at(-20, 3, -20)).toBe(0);
  });

  it('is dimmer under a roof, the more so the further in', () => {
    const edge = sky.at(0, 5, 0);
    const middle = sky.at(1, 5, 1);
    expect(edge).toBeLessThan(MAX_LIGHT);
    expect(middle).toBeLessThan(edge);
    expect(middle).toBeGreaterThan(0);
  });

  it('loses a step under a leaf block', () => {
    expect(sky.at(10, 5, 0)).toBe(MAX_LIGHT - 1);
  });

  it('works the light out again around a block that changed, and says where it changed', () => {
    const own = new SkyLight(grid);
    holes.add('1,1');
    const change = own.update(1, 1);
    holes.clear();
    expect(own.at(1, 5, 1)).toBe(MAX_LIGHT);
    expect(change).not.toBeNull();
    expect(change!.minX).toBeLessThanOrEqual(1);
    expect(change!.maxY).toBe(8);
  });
});

describe('vertex shading', () => {
  it('shades tops full, bottoms half and east-west sides dimmest', () => {
    expect(sideShade(0, 1, 0)).toBe(1);
    expect(sideShade(0, -1, 0)).toBe(0.5);
    expect(sideShade(0, 0, 1)).toBeCloseTo(0.8);
    expect(sideShade(1, 0, 0)).toBeCloseTo(0.6);
  });

  it('darkens a corner where blocks meet, fully when both sides are blocked', () => {
    expect(cornerOcclusion(false, false, false)).toBe(3);
    expect(cornerOcclusion(false, false, true)).toBe(2);
    expect(cornerOcclusion(true, false, true)).toBe(1);
    expect(cornerOcclusion(true, true, false)).toBe(0);
  });

  it('never goes fully black', () => {
    expect(lightmap(0)).toBeGreaterThan(0.1);
    expect(lightmap(1)).toBe(1);
    expect(cornerBrightness(1, 3, MAX_LIGHT)).toBe(1);
    expect(cornerBrightness(1, 0, MAX_LIGHT)).toBeCloseTo(0.4);
  });
});
