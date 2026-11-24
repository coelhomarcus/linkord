import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { BLOCK } from '@game/blocks';
import { BlockGrid } from '@game/grid';
import { DroppedItems } from '@/features/playground/engine/droppedItems';
import type { ItemModels } from '@/features/playground/engine/itemModels';
import type { GroundItem } from '@/features/playground/worldState';

const GROUND = 10;

function flat(): BlockGrid {
  const grid = new BlockGrid();
  for (let x = -4; x < 4; x++) for (let z = -4; z < 4; z++) grid.set(x, GROUND - 1, z, BLOCK.stone);
  return grid;
}

/** Models with nothing to draw: only where they are matters here. */
const models = {
  create: () => {
    const object = new THREE.Group();
    return { object, shape: 'block' as const, handheld: false, setLight: () => {}, dispose: () => object.removeFromParent() };
  },
} as unknown as ItemModels;

describe('DroppedItems', () => {
  let now = 0;
  beforeEach(() => {
    now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
  });
  afterEach(() => vi.restoreAllMocks());

  const item = (start: Partial<GroundItem['start']> = {}): GroundItem => ({
    id: 1, item: 'stone', count: 1, age: 0, receivedAt: now,
    start: { x: 0.5, y: GROUND + 5, z: 0.5, vx: 0, vy: 0, vz: 0, ...start },
  });
  const heightOf = (dropped: DroppedItems) => (dropped.group.children[0] as THREE.Object3D).position.y;

  it('falls smoothly: drawn between its ticks at the frame rate, not in 20-a-second jumps', () => {
    const grid = flat();
    const dropped = new DroppedItems(models, () => grid, () => 1);
    dropped.add(item());
    const heights: number[] = [];
    // 60 frames a second for half a second: every frame shows it a little lower
    for (let frame = 0; frame < 30; frame++) {
      dropped.update(1 / 60);
      heights.push(heightOf(dropped));
    }
    const falling = heights.slice(3, 12);
    for (let i = 1; i < falling.length; i++) expect(falling[i]!).toBeLessThan(falling[i - 1]!);
  });

  it('glides to where it is heard to be now instead of jumping there', () => {
    const grid = flat();
    const dropped = new DroppedItems(models, () => grid, () => 1);
    dropped.add(item({ y: GROUND }));
    for (let frame = 0; frame < 10; frame++) dropped.update(1 / 60);
    const before = heightOf(dropped);
    // two blocks put under it: the service moves it up onto them
    grid.set(0, GROUND, 0, BLOCK.stone);
    grid.set(0, GROUND + 1, 0, BLOCK.stone);
    dropped.add(item({ y: GROUND + 2 }));
    dropped.update(1 / 60);
    const right = heightOf(dropped);
    expect(right - before).toBeLessThan(0.5);
    for (let frame = 0; frame < 60; frame++) dropped.update(1 / 60);
    expect(heightOf(dropped) - before).toBeGreaterThan(1.8);
  });
});
