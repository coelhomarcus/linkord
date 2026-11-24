import { describe, expect, it } from 'vitest';
import { ATTACK_REACH, cellBox, playerBox, rayBoxDistance, targetPlayer } from '@/features/playground/engine/playerTarget';

const eye = { x: 0, y: 1.62, z: 0 };
// looking toward -z, level
const ahead = { x: 0, y: 0, z: -1 };
const at = (x: number, y: number, z: number) => ({ position: { x, y, z } });

describe('rayBoxDistance', () => {
  it('meets a box ahead where the ray enters it, and misses one behind or aside', () => {
    expect(rayBoxDistance(eye, ahead, cellBox({ x: -1, y: 1, z: -3 }))).toBeCloseTo(2);
    expect(rayBoxDistance(eye, ahead, cellBox({ x: -1, y: 1, z: 2 }))).toBeNull();
    expect(rayBoxDistance(eye, ahead, cellBox({ x: 3, y: 1, z: -3 }))).toBeNull();
  });

  it('is right here from inside the box', () => {
    expect(rayBoxDistance(eye, ahead, playerBox({ x: 0, y: 0, z: 0 }))).toBe(0);
  });
});

describe('targetPlayer', () => {
  it('picks the nearest player the eyes look at, within 3 blocks', () => {
    const players: [string, ReturnType<typeof at>][] = [['far', at(0, 0, -2.8)], ['near', at(0.2, 0, -1.5)], ['aside', at(2, 0, -1)]];
    expect(targetPlayer(eye, ahead, players)).toBe('near');
    expect(targetPlayer(eye, ahead, [['out', at(0, 0, -ATTACK_REACH - 0.6)]])).toBeNull();
  });

  it('counts a box a little larger than the body', () => {
    // the body's edge is 0.3 from its centre; the punch still lands 0.38 off
    expect(targetPlayer(eye, ahead, [['edge', at(0.38, 0, -2)]])).toBe('edge');
    expect(targetPlayer(eye, ahead, [['past', at(0.45, 0, -2)]])).toBeNull();
  });

  it('does not reach through a block in front of the player', () => {
    expect(targetPlayer(eye, ahead, [['behind', at(0, 0, -2.5)]], 1.2)).toBeNull();
    expect(targetPlayer(eye, ahead, [['before', at(0, 0, -1)]], 1.2)).toBe('before');
  });
});
