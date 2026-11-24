import { describe, expect, it } from 'vitest';
import { REACH, targetBlock } from '@/features/playground/engine/blockTarget';

const blocks = new Set(['3,1,0', '0,-1,0', '-2,1,-2']);
const isBlock = (x: number, y: number, z: number) => blocks.has(`${x},${y},${z}`);
const eye = { x: 0.5, y: 1.62, z: 0.5 };

describe('targetBlock', () => {
  it('finds the first block straight ahead', () => {
    expect(targetBlock(isBlock, eye, { x: 1, y: 0, z: 0 })).toEqual({ x: 3, y: 1, z: 0, face: [-1, 0, 0] });
  });

  it('finds the block underfoot when looking down', () => {
    expect(targetBlock(isBlock, eye, { x: 0, y: -1, z: 0 })).toEqual({ x: 0, y: -1, z: 0, face: [0, 1, 0] });
  });

  it('follows a diagonal through the cells it crosses', () => {
    const d = Math.SQRT1_2;
    expect(targetBlock(isBlock, eye, { x: -d, y: 0, z: -d })).toMatchObject({ x: -2, y: 1, z: -2 });
  });

  it('reaches no further than a player can', () => {
    expect(targetBlock((x) => x === 6, eye, { x: 1, y: 0, z: 0 })).toBeNull();
    expect(targetBlock((x) => x === 4, eye, { x: 1, y: 0, z: 0 }, REACH)).toEqual({ x: 4, y: 1, z: 0, face: [-1, 0, 0] });
    expect(targetBlock(isBlock, eye, { x: 0, y: 1, z: 0 })).toBeNull();
  });
});
