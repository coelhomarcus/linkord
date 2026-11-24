import { describe, expect, it } from 'vitest';
import { BLOCK, LANTERN, TORCH_ON_FLOOR, TORCH_ON_WALL } from '@game/blocks';
import { modelFaces } from '@/features/playground/engine/blockModels';

/** The box round every corner of a model's faces. */
function bounds(block: typeof BLOCK.torch | typeof BLOCK.lantern, state: number) {
  const corners = modelFaces(block, state).flatMap((face) => face.corners);
  const axis = (i: number) => ({ min: Math.min(...corners.map((c) => c[i]!)), max: Math.max(...corners.map((c) => c[i]!)) });
  return { x: axis(0), y: axis(1), z: axis(2) };
}

describe('block models', () => {
  it('stands a torch on the floor in the middle of its cell', () => {
    const box = bounds(BLOCK.torch, TORCH_ON_FLOOR);
    expect(box.y.min).toBe(0);
    expect(box.x.min).toBeGreaterThan(0.35);
    expect(box.x.max).toBeLessThan(0.65);
  });

  it('leans a wall torch out of the wall it is on, whichever way it points', () => {
    // pointing +x: on the wall at -x
    expect(bounds(BLOCK.torch, TORCH_ON_WALL + 3).x.min).toBeLessThan(0.05);
    // pointing +z: on the wall at -z
    expect(bounds(BLOCK.torch, TORCH_ON_WALL + 0).z.min).toBeLessThan(0.05);
    // pointing -x: on the wall at +x, leaning a quarter of a block out from it
    const box = bounds(BLOCK.torch, TORCH_ON_WALL + 1);
    expect(box.x.max).toBeGreaterThan(0.95);
    expect(box.x.min).toBeGreaterThan(0.6);
    expect(box.x.min).toBeLessThan(0.75);
  });

  it('stands a lantern on the floor or hangs it from the ceiling by its chain', () => {
    expect(bounds(BLOCK.lantern, LANTERN.standing).y).toEqual({ min: 0, max: 11 / 16 });
    expect(bounds(BLOCK.lantern, LANTERN.hanging).y).toEqual({ min: 1 / 16, max: 1 });
  });

  it('gives every face a texture rectangle inside its 16×16 tile', () => {
    for (const [block, state] of [[BLOCK.torch, TORCH_ON_WALL + 2], [BLOCK.lantern, LANTERN.hanging]] as const) {
      for (const face of modelFaces(block, state)) {
        expect(face.corners).toHaveLength(4);
        for (const [u, v] of face.uvs) {
          expect(u).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(16);
        }
      }
    }
  });
});
