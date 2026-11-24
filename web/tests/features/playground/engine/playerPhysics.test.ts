import { describe, expect, it } from 'vitest';
import { createBody, stepBody, TICK_SECONDS } from '@/features/playground/engine/playerPhysics';
import type { PhysicsBody, PhysicsInput, Terrain } from '@/features/playground/engine/playerPhysics';

const MAX_HEIGHT = 24;

/** flat ground at 5, a one-block step from x = 3, a two-block wall from x = 6, sea from z = 8 */
const terrain: Terrain = {
  groundAt: (x, z) => (z >= 8 ? 2 : x >= 6 ? 8 : x >= 3 ? 6 : 5),
  isWater: (_x, z) => z >= 8,
};

// yaw -π/2 looks toward +x
const input = (overrides: Partial<PhysicsInput> = {}): PhysicsInput => ({
  forward: 1, right: 0, yaw: -Math.PI / 2, sprint: false, sneak: false, jump: false, autoJump: false, ...overrides,
});

function run(body: PhysicsBody, ticks: number, given: PhysicsInput): PhysicsBody {
  for (let i = 0; i < ticks; i++) stepBody(terrain, body, given, MAX_HEIGHT);
  return body;
}

function speedAfter(given: PhysicsInput): number {
  const body = createBody(-30, 5, 0);
  run(body, 40, given);
  const x = body.x;
  run(body, 20, given);
  return (body.x - x) / (20 * TICK_SECONDS);
}

describe('playerPhysics', () => {
  it('walks at the game\'s 4.3 blocks a second, sprints 30% faster and sneaks at 30%', () => {
    expect(speedAfter(input())).toBeCloseTo(4.3, 1);
    expect(speedAfter(input({ sprint: true }))).toBeCloseTo(5.6, 1);
    expect(speedAfter(input({ sneak: true }))).toBeCloseTo(1.3, 1);
  });

  it('jumps about a block and a quarter and lands', () => {
    const body = createBody(0, 5, 0);
    let peak = 5;
    stepBody(terrain, body, input({ forward: 0, jump: true }), MAX_HEIGHT);
    for (let i = 0; i < 30; i++) {
      stepBody(terrain, body, input({ forward: 0 }), MAX_HEIGHT);
      peak = Math.max(peak, body.y);
    }
    expect(peak - 5).toBeGreaterThan(1.2);
    expect(peak - 5).toBeLessThan(1.3);
    expect(body.y).toBe(5);
    expect(body.onGround).toBe(true);
  });

  it('stops at a one-block step until it jumps onto it', () => {
    const body = run(createBody(2, 5, 0), 20, input());
    expect(body.x).toBeLessThan(3 - 0.29);
    expect(body.collidedHorizontally).toBe(true);
    stepBody(terrain, body, input({ jump: true }), MAX_HEIGHT);
    run(body, 20, input());
    expect(body.y).toBe(6);
    expect(body.x).toBeGreaterThan(3);
  });

  it('jumps onto a step by itself with auto-jump, but never over two blocks', () => {
    const body = run(createBody(2, 5, 0), 30, input({ autoJump: true }));
    expect(body.y).toBe(6);
    run(body, 40, input({ autoJump: true }));
    expect(body.x).toBeLessThan(6);
    expect(body.y).toBe(6);
  });

  it('keeps out of the sea', () => {
    // yaw 0 looks toward -z, so backwards walks toward the sea at +z
    const body = run(createBody(0, 5, 6), 40, input({ yaw: 0, forward: -1 }));
    expect(body.z).toBeLessThan(8 - 0.29);
  });

  it('does not walk off a ledge while sneaking, and falls off one otherwise', () => {
    const sneaking = run(createBody(4, 6, 0), 40, input({ yaw: Math.PI / 2, sneak: true }));
    expect(sneaking.y).toBe(6);
    expect(sneaking.x).toBeGreaterThan(3 - 0.3);
    const walking = run(createBody(4, 6, 0), 40, input({ yaw: Math.PI / 2 }));
    expect(walking.y).toBe(5);
  });

  it('carries a sprint jump further than a walking one', () => {
    const distance = (sprint: boolean) => {
      const body = run(createBody(-30, 5, 0), 30, input({ sprint }));
      const x = body.x;
      stepBody(terrain, body, input({ sprint, jump: true }), MAX_HEIGHT);
      for (let i = 0; i < 40 && !(body.onGround && body.vy <= 0 && i > 2); i++) stepBody(terrain, body, input({ sprint }), MAX_HEIGHT);
      return body.x - x;
    };
    expect(distance(true)).toBeGreaterThan(distance(false) + 1);
  });
});
