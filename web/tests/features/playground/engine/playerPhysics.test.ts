import { describe, expect, it } from 'vitest';
import { applyKnockback, createBody, stepBody, TICK_SECONDS } from '@/features/playground/engine/playerPhysics';
import type { PhysicsBody, PhysicsInput, Terrain } from '@/features/playground/engine/playerPhysics';

const MAX_HEIGHT = 24;

const groundAt = (x: number) => (x >= 6 ? 8 : x >= 3 ? 6 : 5);
/** flat ground at 5, a one-block step from x = 3, a two-block wall from x = 6, sea (a wall) from z = 8,
 * and one block of leaves hanging at head height over x = -10 */
const terrain: Terrain = {
  isSolid: (x, y, z) => z >= 8 || y < groundAt(x) || (x === -10 && y === 6 && z === 0),
  isWater: () => false,
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

  it('bumps into a block hanging at head height, and walks under nothing', () => {
    const body = run(createBody(-14, 5, 0.5), 40, input());
    expect(body.x).toBeLessThan(-10 - 0.29);
    expect(body.collidedHorizontally).toBe(true);
  });

  it('stands on top of the leaves it lands on', () => {
    const body = createBody(-9.5, 7.5, 0.5);
    run(body, 20, input({ forward: 0 }));
    expect(body.y).toBe(7);
    expect(body.onGround).toBe(true);
  });

  it('hits its head on a ceiling and falls back', () => {
    const ceiling: Terrain = { isSolid: (_x, y) => y < 5 || y === 7, isWater: () => false };
    const body = createBody(0.5, 5, 0.5);
    stepBody(ceiling, body, input({ forward: 0, jump: true }), MAX_HEIGHT);
    let peak = body.y;
    for (let i = 0; i < 20; i++) {
      stepBody(ceiling, body, input({ forward: 0 }), MAX_HEIGHT);
      peak = Math.max(peak, body.y);
    }
    // the ceiling's underside is 7: the head (1.8 tall) stops the feet at 5.2
    expect(peak).toBeCloseTo(5.2, 5);
    expect(body.y).toBe(5);
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

  it('counts how far it falls, only on the way down, and forgets it on landing', () => {
    const body = createBody(0, 5, 0);
    stepBody(terrain, body, input({ forward: 0, jump: true }), MAX_HEIGHT);
    expect(body.fallDistance).toBe(0);
    let fell = 0;
    for (let i = 0; i < 30 && !body.onGround; i++) {
      stepBody(terrain, body, input({ forward: 0 }), MAX_HEIGHT);
      fell = Math.max(fell, body.fallDistance);
    }
    expect(fell).toBeGreaterThan(1);
    expect(body.onGround).toBe(true);
    expect(body.fallDistance).toBe(0);
  });

  it('takes a knockback the game\'s way: half its speed, the push, and up to 0.4 up', () => {
    const body = { ...createBody(0, 5, 0), vx: 0.2, vy: -0.08, vz: 0 };
    applyKnockback(body, [0.4, 0]);
    expect(body.vx).toBeCloseTo(0.5);
    expect(body.vy).toBeCloseTo(0.36);
    expect(body.onGround).toBe(false);
    const sprinted = { ...createBody(0, 5, 0), vy: 0.3 };
    applyKnockback(sprinted, [0, 0.4], [0, 0.1, 0.5]);
    expect(sprinted.vy).toBeCloseTo(0.5);
    expect(sprinted.vz).toBeCloseTo(0.9);
  });
});

describe('swimming', () => {
  /** a pool: water from y = 2 to 7 over x < 4, its floor at 2, dry ground at 8 from x = 4 */
  const pool: Terrain = {
    isSolid: (x, y) => y < 2 || (x >= 4 && y < 8),
    isWater: (x, y) => x < 4 && y >= 2 && y < 8,
  };

  it('sinks slowly, and Space swims up to the surface', () => {
    const body = createBody(0.5, 5, 0.5);
    for (let i = 0; i < 10; i++) stepBody(pool, body, input({ forward: 0 }), MAX_HEIGHT);
    expect(body.inWater).toBe(true);
    // far slower than a fall through air (which would cover about 2 blocks in 10 ticks)
    expect(body.y).toBeGreaterThan(4);
    expect(body.y).toBeLessThan(5);
    for (let i = 0; i < 40; i++) stepBody(pool, body, input({ forward: 0, jump: true }), MAX_HEIGHT);
    expect(body.y).toBeGreaterThan(6);
  });

  it('climbs out over the edge of the pool when walking into it', () => {
    const body = createBody(3.2, 6.5, 0.5);
    for (let i = 0; i < 40; i++) stepBody(pool, body, input({ jump: true }), MAX_HEIGHT);
    expect(body.x).toBeGreaterThan(4);
    expect(body.y).toBeGreaterThanOrEqual(8);
  });
});
