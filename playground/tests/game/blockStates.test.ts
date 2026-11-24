import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BLOCK, BLOCK_COUNT, blockDef, coloredBlock, COLORED_KINDS, COLORS, LOG_AXIS, placedState } from '../../src/game/blocks.js';
import { BlockGrid, CELL_COUNT } from '../../src/game/grid.js';
import { itemDef } from '../../src/game/items.js';

describe('block states', () => {
  test('a log lies along the axis of the face it was placed against', () => {
    assert.equal(placedState(BLOCK.log, 0), LOG_AXIS.x);
    assert.equal(placedState(BLOCK.log, 1), LOG_AXIS.x);
    assert.equal(placedState(BLOCK.log, 3), LOG_AXIS.y);
    assert.equal(placedState(BLOCK.log, 5), LOG_AXIS.z);
    assert.equal(placedState(BLOCK.log, -1), LOG_AXIS.y);
    assert.equal(placedState(BLOCK.stone, 0), 0);
  });

  test('stored states that mean nothing for their block are read as 0, and unknown blocks as air', () => {
    const blocks = new Uint8Array(CELL_COUNT);
    const states = new Uint8Array(CELL_COUNT);
    blocks[0] = BLOCK.log; states[0] = LOG_AXIS.z;
    blocks[1] = BLOCK.stone; states[1] = 2;
    blocks[2] = BLOCK.log; states[2] = 9;
    blocks[3] = 250; states[3] = 1;
    const grid = BlockGrid.from(blocks, states);
    assert.deepEqual([...grid.states.slice(0, 4)], [LOG_AXIS.z, 0, 0, 0]);
    assert.equal(grid.blocks[3], BLOCK.air);
    assert.ok(BlockGrid.from(blocks, null).states.every((state) => state === 0));
  });
});

describe('coloured blocks', () => {
  test('sixteen of each family, numbered in the colours\' order, each dropping and placed by its own item', () => {
    assert.equal(coloredBlock('wool', 'white'), BLOCK.whiteWool);
    assert.equal(coloredBlock('terracotta', 'black'), BLOCK.blackTerracotta);
    for (const kind of COLORED_KINDS) {
      for (const color of COLORS) {
        const block = coloredBlock(kind, color);
        assert.ok(block < BLOCK_COUNT);
        assert.equal(blockDef(block).drop, `${color}_${kind}`);
        assert.equal(itemDef(`${color}_${kind}`)?.places, block);
      }
    }
    assert.equal(itemDef('terracotta')?.places, BLOCK.terracotta);
  });

  test('concrete and terracotta need a pickaxe, wool comes by hand', () => {
    assert.equal(blockDef(BLOCK.redConcrete).needs, 0);
    assert.equal(blockDef(BLOCK.blueTerracotta).tool, 'pickaxe');
    assert.equal(blockDef(BLOCK.limeWool).needs, null);
  });
});
