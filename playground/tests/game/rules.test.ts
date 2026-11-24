import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BLOCK } from '../../src/game/blocks.js';
import { BlockGrid } from '../../src/game/grid.js';
import { itemDef, maxStackOf } from '../../src/game/items.js';
import { breakTicks, canHarvest, dropOf, hitDamage, wearForBreaking } from '../../src/game/mining.js';
import { matchRecipe, type Stack } from '../../src/game/recipes.js';
import { COOK_TICKS, createFurnace, stepFurnace } from '../../src/game/smelting.js';
import { restingPlace, withinPickup } from '../../src/game/drops.js';

const s = (item: string, count = 1): Stack => ({ item, count });
const grid3 = (...rows: string[]) => rows.join('').split('').map((c) => ({ P: s('oak_planks'), C: s('cobblestone'), S: s('stick'), I: s('iron_ingot'), L: s('oak_log') } as Record<string, Stack>)[c] ?? null);

describe('items', () => {
  test('blocks stack to 64, tools to 1, with the game\'s numbers', () => {
    assert.equal(maxStackOf('oak_planks'), 64);
    assert.equal(maxStackOf('diamond_sword'), 1);
    assert.deepEqual(itemDef('diamond_sword')?.tool, { kind: 'sword', tier: 'diamond', level: 3, speed: 8, damage: 8, durability: 1561 });
    assert.equal(itemDef('wooden_pickaxe')?.tool?.damage, 3);
    assert.equal(itemDef('nothing'), null);
  });
});

describe('crafting', () => {
  test('a log makes four planks anywhere in the grid, two planks four sticks', () => {
    assert.deepEqual(matchRecipe([null, null, null, s('oak_log')], 2), s('oak_planks', 4));
    assert.deepEqual(matchRecipe(grid3('  P', '  P', '   '), 3), s('stick', 4));
  });

  test('a 2×2 of planks is a crafting table; eight cobblestones a furnace', () => {
    assert.deepEqual(matchRecipe([s('oak_planks'), s('oak_planks'), s('oak_planks'), s('oak_planks')], 2), s('crafting_table'));
    assert.deepEqual(matchRecipe(grid3('CCC', 'C C', 'CCC'), 3), s('furnace'));
    assert.equal(matchRecipe(grid3('CCC', 'CCC', 'CCC'), 3), null);
  });

  test('coal or charcoal over a stick makes four torches; nuggets round a torch a lantern', () => {
    assert.deepEqual(matchRecipe([s('coal'), null, s('stick'), null], 2), s('torch', 4));
    assert.deepEqual(matchRecipe([null, s('charcoal'), null, s('stick')], 2), s('torch', 4));
    assert.deepEqual(matchRecipe([null, null, null, s('iron_ingot')], 2), s('iron_nugget', 9));
    const nuggets = (middle: Stack) => Array.from({ length: 9 }, (_, i) => (i === 4 ? middle : s('iron_nugget')));
    assert.deepEqual(matchRecipe(nuggets(s('torch')), 3), s('lantern'));
    assert.deepEqual(matchRecipe(nuggets(s('iron_nugget')), 3), s('iron_ingot'));
  });

  test('tools take their shape, mirrored too, but not any other', () => {
    assert.deepEqual(matchRecipe(grid3('III', ' S ', ' S '), 3), s('iron_pickaxe'));
    assert.deepEqual(matchRecipe(grid3('PP ', 'PS ', ' S '), 3), s('wooden_axe'));
    assert.deepEqual(matchRecipe(grid3(' PP', ' SP', ' S '), 3), s('wooden_axe'));
    assert.deepEqual(matchRecipe(grid3(' C ', ' C ', ' S '), 3), s('stone_sword'));
    assert.equal(matchRecipe(grid3('III', 'S  ', ' S '), 3), null);
    // a pickaxe needs the 3×3 table
    assert.equal(matchRecipe([s('iron_ingot'), s('iron_ingot'), null, s('stick')], 2), null);
  });
});

describe('mining', () => {
  test('a hand takes the game\'s time; the right tool is faster', () => {
    assert.equal(breakTicks(BLOCK.dirt, null), 15);
    assert.equal(breakTicks(BLOCK.dirt, 'wooden_shovel'), 8);
    assert.equal(breakTicks(BLOCK.stone, null), 150);
    assert.equal(breakTicks(BLOCK.stone, 'wooden_pickaxe'), 23);
    assert.equal(breakTicks(BLOCK.bedrock, 'diamond_pickaxe'), null);
    assert.equal(breakTicks(BLOCK.frame, null), null);
  });

  test('stone and ores drop only for a good enough pickaxe', () => {
    assert.equal(dropOf(BLOCK.stone, null, 0.5), null);
    assert.equal(dropOf(BLOCK.stone, 'wooden_pickaxe', 0.5), 'cobblestone');
    assert.equal(canHarvest(BLOCK.ironOre, 'wooden_pickaxe'), false);
    assert.equal(dropOf(BLOCK.ironOre, 'stone_pickaxe', 0.5), 'iron_ore');
    assert.equal(dropOf(BLOCK.diamondOre, 'iron_pickaxe', 0.5), 'diamond');
    assert.equal(dropOf(BLOCK.grass, null, 0.5), 'dirt');
    assert.equal(dropOf(BLOCK.leaves, null, 0.5), null);
    assert.equal(dropOf(BLOCK.leaves, null, 0.01), 'stick');
    assert.equal(dropOf(BLOCK.leaves, null, 0.996), 'apple');
  });

  test('tools wear, swords twice as fast on blocks; damage by what is held', () => {
    assert.equal(wearForBreaking('stone_pickaxe', BLOCK.stone), 1);
    assert.equal(wearForBreaking('stone_sword', BLOCK.stone), 2);
    assert.equal(wearForBreaking(null, BLOCK.stone), 0);
    assert.equal(hitDamage(null), 1);
    assert.equal(hitDamage('iron_sword'), 7);
  });
});

describe('smelting', () => {
  test('coal smelts eight items, 10 s each, into the output', () => {
    const furnace = createFurnace();
    furnace.slots = [s('iron_ore', 9), s('coal', 1), null];
    stepFurnace(furnace, COOK_TICKS);
    assert.deepEqual(furnace.slots, [s('iron_ore', 8), null, s('iron_ingot', 1)]);
    stepFurnace(furnace, COOK_TICKS * 8);
    assert.deepEqual(furnace.slots, [s('iron_ore', 1), null, s('iron_ingot', 8)]);
    assert.equal(furnace.burn, 0);
  });

  test('cooks raw meat', () => {
    for (const raw of ['beef', 'porkchop', 'mutton', 'chicken']) {
      const furnace = createFurnace();
      furnace.slots = [s(raw, 1), s('coal', 1), null];
      stepFurnace(furnace, COOK_TICKS);
      assert.deepEqual(furnace.slots[2], s(`cooked_${raw}`, 1));
    }
  });

  test('takes no fuel with nothing to cook, or no room for what it makes', () => {
    const idle = createFurnace();
    idle.slots = [s('dirt'), s('coal'), null];
    stepFurnace(idle, 50);
    assert.deepEqual(idle.slots[1], s('coal'));
    const full = createFurnace();
    full.slots = [s('sand'), s('coal'), s('stone', 1)];
    stepFurnace(full, 50);
    assert.deepEqual(full.slots[1], s('coal'));
  });
});

describe('items on the ground', () => {
  test('fall to the ground and rest on it; are picked up from close by', () => {
    const grid = new BlockGrid();
    for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) grid.set(x, 10, z, BLOCK.stone);
    const rest = restingPlace(grid, { x: 0.5, y: 15, z: 0.5, vx: 0, vy: 0, vz: 0 });
    assert.deepEqual(rest, { x: 0.5, y: 11, z: 0.5 });
    assert.equal(withinPickup({ x: 1.5, y: 11, z: 0.5 }, rest), true);
    assert.equal(withinPickup({ x: 3.5, y: 11, z: 0.5 }, rest), false);
  });
});
