import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BLOCK } from '../../src/game/blocks.js';
import { BlockGrid } from '../../src/game/grid.js';
import { HALF, PLAZA_HEIGHT, SCREEN_WALL, SEA_LEVEL, spawnPoint } from '../../src/game/layout.js';
import { generateWorld } from '../../src/game/worldGen.js';

const { grid, furnaces } = generateWorld();

function count(predicate: (block: number, y: number) => boolean): number {
  let n = 0;
  for (let i = 0; i < grid.blocks.length; i++) if (predicate(grid.blocks[i]!, Math.floor(i / (2 * HALF * 2 * HALF)))) n++;
  return n;
}

describe('the generated world', () => {
  test('is the same every time', () => {
    assert.deepEqual(generateWorld().grid.blocks, grid.blocks);
  });

  test('lands everyone on the plaza, on dry grass (no wooden floor any more)', () => {
    for (const id of ['a', 'b', 'c', 'some-connection']) {
      const spawn = spawnPoint(id);
      assert.equal(grid.groundAt(spawn.x, spawn.z), PLAZA_HEIGHT);
      assert.equal(grid.get(Math.floor(spawn.x), PLAZA_HEIGHT - 1, Math.floor(spawn.z)), BLOCK.grass);
    }
    assert.equal(count((block) => block === BLOCK.planks), 0);
  });

  test('is an island: the edge is sea, water up to its level', () => {
    for (let i = -HALF; i < HALF; i += 8) {
      assert.equal(grid.get(i, SEA_LEVEL - 1, -HALF), BLOCK.water);
      assert.equal(grid.get(-HALF, SEA_LEVEL - 1, i), BLOCK.water);
      assert.equal(grid.get(i, SEA_LEVEL, -HALF), BLOCK.air);
    }
  });

  test('stands the screen wall in front of the plaza, too tall to step onto', () => {
    assert.equal(grid.get(0, PLAZA_HEIGHT + 3, SCREEN_WALL.z), BLOCK.frame);
    assert.equal(grid.groundAt(0.5, SCREEN_WALL.z + 0.5), SCREEN_WALL.top);
  });

  test('has bedrock under everything, and ores the deeper the rarer', () => {
    for (const [x, z] of [[0, 0], [-60, 60], [40, -40]] as const) assert.equal(grid.get(x, 0, z), BLOCK.bedrock);
    const coal = count((block) => block === BLOCK.coalOre);
    const iron = count((block) => block === BLOCK.ironOre);
    const diamonds = count((block) => block === BLOCK.diamondOre);
    assert.ok(coal > iron && iron > diamonds && diamonds > 0, `coal ${coal}, iron ${iron}, diamonds ${diamonds}`);
    assert.equal(count((block, y) => block === BLOCK.diamondOre && y > 14), 0);
  });

  test('grows a forest and more, and keeps a crafting table and a furnace by the plaza', () => {
    assert.ok(count((block) => block === BLOCK.log) > 600);
    assert.equal(count((block) => block === BLOCK.craftingTable), 1);
    assert.equal(furnaces.length, 1);
    const [furnace] = furnaces;
    assert.equal(grid.get(furnace!.x, furnace!.y, furnace!.z), BLOCK.furnace);
  });

  test('raises a mountain and opens a cave into it', () => {
    let peak = 0;
    for (let x = 10; x < 50; x++) for (let z = -50; z < -10; z++) peak = Math.max(peak, grid.groundAt(x, z));
    assert.ok(peak > 48, `peak ${peak}`);
    // somewhere under the mountain's ground there is air
    let caveAir = 0;
    for (let x = 20; x < 36; x++) for (let z = -32; z < -18; z++) for (let y = 10; y < grid.groundAt(x, z) - 3; y++) if (grid.get(x, y, z) === BLOCK.air) caveAir++;
    assert.ok(caveAir > 50, `cave air ${caveAir}`);
  });

  test('round-trips through stored bytes, unknown blocks as air', () => {
    const bytes = new Uint8Array(grid.blocks);
    bytes[BlockGrid.index(0, 1, 0)] = 250;
    const restored = BlockGrid.from(bytes);
    assert.equal(restored.get(0, 1, 0), BLOCK.air);
    assert.equal(restored.get(0, 0, 0), BLOCK.bedrock);
  });
});
