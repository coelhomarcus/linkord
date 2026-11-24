import { describe, expect, it } from 'vitest';
import { BLOCK } from '@game/blocks';
import type { Block } from '@game/blocks';
import { HEIGHT, PLAZA_HEIGHT, SCREEN_WALL } from '@game/layout';
import { BlockGrid } from '@game/grid';
import { BlockLight, MAX_LIGHT, SCREEN_LIGHT_CELLS, ScreenLight, SkyLight } from '@game/light';
import { cornerBrightness, cornerOcclusion, lightmap, sideShade } from '@/features/playground/engine/lighting';

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

describe('BlockLight', () => {
  /** a stone floor up to y = 4 and a closed stone room over x, z -3..3 (walls at ±4), y 5..7 */
  function cave(): BlockGrid {
    const world = new BlockGrid();
    for (let x = -20; x <= 20; x++) {
      for (let z = -20; z <= 20; z++) {
        for (let y = 0; y < 5; y++) world.set(x, y, z, BLOCK.stone);
        const wall = Math.abs(x) === 4 || Math.abs(z) === 4;
        if (Math.abs(x) <= 4 && Math.abs(z) <= 4) for (let y = 5; y <= 8; y++) if (wall || y === 8) world.set(x, y, z, BLOCK.stone);
      }
    }
    return world;
  }

  it('is dark where nothing gives off light', () => {
    const light = new BlockLight(cave());
    expect(light.at(0, 5, 0)).toBe(0);
  });

  it('starts at a torch and loses a step per block, through air but not stone', () => {
    const world = cave();
    world.set(0, 5, 0, BLOCK.torch);
    const light = new BlockLight(world);
    expect(light.at(0, 5, 0)).toBe(14);
    expect(light.at(1, 5, 0)).toBe(13);
    expect(light.at(3, 6, 3)).toBe(14 - 7);
    // the walls and roof are stone, and none of it gets out
    expect(light.at(4, 5, 0)).toBe(0);
    expect(light.at(5, 5, 0)).toBe(0);
  });

  it('gives glowstone its full 15 to the cells around it', () => {
    const world = cave();
    world.set(0, 5, 0, BLOCK.glowstone);
    const light = new BlockLight(world);
    expect(light.at(1, 5, 0)).toBe(14);
    expect(light.at(0, 6, 0)).toBe(14);
  });

  it('relights only around a torch placed or broken, the same as working it all out again', () => {
    const world = cave();
    const light = new BlockLight(world);
    world.set(2, 6, -1, BLOCK.torch);
    const placed = light.update(2, 6, -1);
    expect(placed).toMatchObject({ minX: -3, maxX: 3, minY: 5, maxY: 7, minZ: -3, maxZ: 3 });
    const fresh = new BlockLight(world);
    for (let x = -5; x <= 5; x++) for (let y = 5; y <= 9; y++) for (let z = -5; z <= 5; z++) expect(light.at(x, y, z)).toBe(fresh.at(x, y, z));

    world.set(2, 6, -1, BLOCK.air);
    const broken = light.update(2, 6, -1);
    expect(broken).not.toBeNull();
    for (let x = -5; x <= 5; x++) for (let y = 5; y <= 9; y++) for (let z = -5; z <= 5; z++) expect(light.at(x, y, z)).toBe(0);
  });

  it('says nothing changed when a block changes out of every light', () => {
    const world = cave();
    const light = new BlockLight(world);
    world.set(15, 5, 15, BLOCK.stone);
    expect(light.update(15, 5, 15)).toBeNull();
  });
});

describe('ScreenLight', () => {
  /** flat ground up to the plaza's surface and the screen's wall of frame blocks */
  function plaza(): BlockGrid {
    const world = new BlockGrid();
    for (let x = -30; x <= 30; x++) for (let z = -40; z <= 10; z++) for (let y = 0; y < PLAZA_HEIGHT; y++) world.set(x, y, z, BLOCK.stone);
    for (let x = SCREEN_WALL.minX; x < SCREEN_WALL.maxX; x++) for (let y = SCREEN_WALL.bottom; y < SCREEN_WALL.top; y++) world.set(x, y, SCREEN_WALL.z, BLOCK.frame);
    return world;
  }
  const front = SCREEN_LIGHT_CELLS.z;

  it('starts full in front of the picture and fades with distance across the plaza', () => {
    const light = new ScreenLight(plaza());
    expect(light.at(0, PLAZA_HEIGHT, front)).toBe(MAX_LIGHT);
    expect(light.at(0, PLAZA_HEIGHT, front + 5)).toBe(MAX_LIGHT - 5);
    expect(light.at(0, PLAZA_HEIGHT, front + 20)).toBe(0);
  });

  it('reaches behind the wall of the screen only the long way round, over its top', () => {
    const light = new ScreenLight(plaza());
    const behind = light.at(0, PLAZA_HEIGHT, SCREEN_WALL.z - 1);
    expect(behind).toBeLessThan(light.at(0, PLAZA_HEIGHT, front + 2) - 6);
  });

  it('casts the shadow of a wall on the ground, the same as working it all out again', () => {
    const world = plaza();
    const light = new ScreenLight(world);
    const before = light.at(0, PLAZA_HEIGHT, front + 6);
    // a wall across the plaza, as high as the screen, a few blocks in front of it
    for (let x = -12; x <= 12; x++) for (let y = PLAZA_HEIGHT; y <= PLAZA_HEIGHT + 10; y++) world.set(x, y, front + 3, BLOCK.stone);
    for (let x = -12; x <= 12; x++) for (let y = PLAZA_HEIGHT; y <= PLAZA_HEIGHT + 10; y++) light.update(x, y, front + 3);
    expect(light.at(0, PLAZA_HEIGHT, front + 6)).toBeLessThan(before);
    expect(light.at(0, PLAZA_HEIGHT, front + 4)).toBeLessThan(light.at(0, PLAZA_HEIGHT, front + 2));
    const fresh = new ScreenLight(world);
    for (let x = -14; x <= 14; x++) for (let y = PLAZA_HEIGHT; y <= PLAZA_HEIGHT + 12; y++) for (let z = front; z <= front + 15; z++) expect(light.at(x, y, z)).toBe(fresh.at(x, y, z));
  });

  it('is covered by a block put right in front of the picture', () => {
    const world = plaza();
    world.set(0, PLAZA_HEIGHT + 2, front, BLOCK.stone);
    const light = new ScreenLight(world);
    expect(light.at(0, PLAZA_HEIGHT + 2, front)).toBe(0);
    expect(light.at(1, PLAZA_HEIGHT + 2, front)).toBe(MAX_LIGHT);
  });

  it('says nothing changed when a block changes out of its reach', () => {
    const world = plaza();
    const light = new ScreenLight(world);
    world.set(0, PLAZA_HEIGHT, 8, BLOCK.stone);
    expect(light.update(0, PLAZA_HEIGHT, 8)).toBeNull();
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
