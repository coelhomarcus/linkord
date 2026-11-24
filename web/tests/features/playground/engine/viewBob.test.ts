import { describe, expect, it } from 'vitest';
import { computeBob, createBobState, tickBob } from '@/features/playground/engine/viewBob';

describe('viewBob', () => {
  it('sways while walking and stops in the air', () => {
    const state = createBobState();
    for (let i = 0; i < 20; i++) tickBob(state, 0.215, true);
    const walking = Array.from({ length: 10 }, (_, i) => computeBob(state, i / 10));
    expect(Math.max(...walking.map((bob) => Math.abs(bob.y)))).toBeGreaterThan(0.05);
    for (let i = 0; i < 20; i++) tickBob(state, 0.215, false);
    expect(Math.abs(computeBob(state, 0.5).y)).toBeLessThan(0.001);
  });
});
