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

describe('the sway\'s pace', () => {
  it('dips once per 1.67 blocks walked: about 2.6 dips a second at walking speed', () => {
    const state = createBobState();
    // walking: 4.3 blocks a second is 0.215 a tick
    let dips = 0;
    let previous = 0;
    let falling = false;
    for (let tick = 0; tick < 200; tick++) {
      tickBob(state, 0.215, true);
      const y = computeBob(state, 0).y;
      if (falling && y > previous) dips++;
      falling = y < previous;
      previous = y;
    }
    // 200 ticks are 10 seconds
    expect(dips / 10).toBeGreaterThan(2.3);
    expect(dips / 10).toBeLessThan(2.9);
  });
});
