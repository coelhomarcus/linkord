import { describe, expect, it } from 'vitest';
import { cameraDistance } from '@/features/playground/engine/cameraCollision';

const terrain = { groundAt: (x: number) => (x < -2 ? 10 : 5), isWater: () => false };

describe('cameraDistance', () => {
  it('keeps the full distance over open ground', () => {
    expect(cameraDistance(terrain, { x: 0, y: 6.6, z: 0 }, { x: 1, y: 0, z: 0 }, 4)).toBe(4);
  });

  it('moves in before a hill, and never into the head', () => {
    const toHill = cameraDistance(terrain, { x: 0, y: 6.6, z: 0 }, { x: -1, y: 0, z: 0 }, 4);
    expect(toHill).toBeLessThan(2);
    expect(toHill).toBeGreaterThanOrEqual(0.4);
    expect(cameraDistance(terrain, { x: 0, y: 6.6, z: 0 }, { x: 0, y: -1, z: 0 }, 4)).toBeCloseTo(1.3);
    expect(cameraDistance(terrain, { x: 0, y: 5.3, z: 0 }, { x: 0, y: -1, z: 0 }, 4)).toBe(0.4);
  });
});
