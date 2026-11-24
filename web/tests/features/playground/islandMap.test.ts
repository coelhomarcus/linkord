import { describe, expect, it } from 'vitest';
import { BLOCK, IslandMap, SCREEN_WALL, SEA_LEVEL, SIZE } from '@/features/playground/islandMap';
import { PLAZA_HEIGHT, spawnPoint } from '@/features/playground/playgroundWorld';

const island = new IslandMap();

describe('IslandMap', () => {
  it('builds the same island every time', () => {
    const other = new IslandMap();
    for (const [x, z] of [[0, 0], [10, 12], [-20, 5], [15, -25]] as const) expect(other.groundAt(x, z)).toBe(island.groundAt(x, z));
  });

  it('lands everyone on the flat plaza, on dry ground', () => {
    for (const id of ['a', 'b', 'c', 'some-connection']) {
      const spawn = spawnPoint(id);
      expect(island.groundAt(spawn.x, spawn.z)).toBe(PLAZA_HEIGHT);
      expect(island.isWater(spawn.x, spawn.z)).toBe(false);
    }
  });

  it('is an island: the map edge is sea', () => {
    for (let i = -SIZE / 2; i < SIZE / 2; i += 6) {
      expect(island.isWater(i, -SIZE / 2)).toBe(true);
      expect(island.isWater(-SIZE / 2, i)).toBe(true);
    }
    expect(island.groundAt(500, 500)).toBe(0);
    expect(island.groundAt(0, 0)).toBeGreaterThan(SEA_LEVEL);
  });

  it('stands the screen wall in front of the plaza, too tall to step onto', () => {
    expect(island.get(0, PLAZA_HEIGHT + 3, SCREEN_WALL.z)).toBe(BLOCK.frame);
    expect(island.groundAt(0.5, SCREEN_WALL.z + 0.5)).toBe(SCREEN_WALL.top);
  });

  it('grows trees, whose trunks are walls but whose leaves are not ground', () => {
    let logs = 0;
    let leaves = 0;
    island.forEachBlock((_x, _y, _z, block) => {
      if (block === BLOCK.log) logs++;
      if (block === BLOCK.leaves) leaves++;
    });
    expect(logs).toBeGreaterThan(20);
    expect(leaves).toBeGreaterThan(logs);
  });
});
