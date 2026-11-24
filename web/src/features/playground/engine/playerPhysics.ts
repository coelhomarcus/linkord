// How the local avatar moves: the block-game rules, stepped at their own 20
// ticks a second and drawn in between (PlaygroundEngine interpolates), so
// walking, sprinting, sneaking and jumping feel the way players expect: speed
// that builds up and slides off over a few ticks, a 1.25-block jump, a sprint
// jump that carries forward, a sneak that stops at edges.
//
// Ported from prismarine-physics (github.com/zardoy/prismarine-physics, MIT,
// Copyright (c) 2020 PrismarineJS), reduced to our world: columns of blocks
// with one ground height each, and a sea nobody can walk into.

/** Seconds per physics tick. */
export const TICK_SECONDS = 0.05;

const GRAVITY = 0.08;
const AIR_DRAG = 0.98;
const JUMP_VELOCITY = 0.42;
const SPRINT_JUMP_BOOST = 0.2;
const JUMP_COOLDOWN_TICKS = 10;
const WALK_SPEED = 0.1;
const SPRINT_MULTIPLIER = 1.3;
const SNEAK_MULTIPLIER = 0.3;
const INPUT_SCALE = 0.98;
const GROUND_INERTIA = 0.6 * 0.91;
const AIR_INERTIA = 0.91;
const AIR_ACCELERATION = 0.02;
const AIR_SPRINT_ACCELERATION = AIR_ACCELERATION * 0.3;
const NEGLIGIBLE_VELOCITY = 0.003;
/** what a sneak refuses to drop off */
const SNEAK_EDGE_DROP = 0.6;
const SNEAK_EDGE_STEP = 0.05;

export const HALF_WIDTH = 0.3;
export const STANDING_EYE_HEIGHT = 1.62;
export const SNEAKING_EYE_HEIGHT = 1.27;
const EPSILON = 1e-7;

/** The ground: where feet rest in each column, and which columns are sea. */
export interface Terrain {
  groundAt(x: number, z: number): number;
  isWater(x: number, z: number): boolean;
}

export interface PhysicsInput {
  /** -1..1, positive is forward */
  forward: number;
  /** -1..1, positive is right */
  right: number;
  /** heading the input is relative to: the camera's yaw (0 looks toward -z) */
  yaw: number;
  sprint: boolean;
  sneak: boolean;
  jump: boolean;
  /** jump on its own onto a one-block step walked into (touch screens) */
  autoJump: boolean;
}

export interface PhysicsBody {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  onGround: boolean;
  /** walked into a wall this tick: a sprint ends there */
  collidedHorizontally: boolean;
  jumpTicks: number;
}

export function createBody(x: number, y: number, z: number): PhysicsBody {
  return { x, y, z, vx: 0, vy: 0, vz: 0, onGround: true, collidedHorizontally: false, jumpTicks: 0 };
}

/** The cells a body standing at (x, z) covers. */
function forEachCell(x: number, z: number, visit: (cx: number, cz: number) => boolean | void): boolean {
  const x0 = Math.floor(x - HALF_WIDTH);
  const x1 = Math.floor(x + HALF_WIDTH - EPSILON);
  const z0 = Math.floor(z - HALF_WIDTH);
  const z1 = Math.floor(z + HALF_WIDTH - EPSILON);
  for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) if (visit(cx + 0.5, cz + 0.5)) return true;
  return false;
}

/** The highest ground under any part of a body at (x, z). */
export function groundUnder(terrain: Terrain, x: number, z: number): number {
  let ground = 0;
  forEachCell(x, z, (cx, cz) => { ground = Math.max(ground, terrain.groundAt(cx, cz)); });
  return ground;
}

/** A body with its feet at y does not fit at (x, z): a column above its feet, or the sea. */
function blocked(terrain: Terrain, x: number, z: number, y: number): boolean {
  return forEachCell(x, z, (cx, cz) => terrain.isWater(cx, cz) || terrain.groundAt(cx, cz) > y + EPSILON);
}

/** Moves along one horizontal axis, stopping flush against the first column in the way. */
function moveAxis(terrain: Terrain, body: PhysicsBody, axis: 'x' | 'z', delta: number): boolean {
  if (delta === 0) return false;
  const nx = axis === 'x' ? body.x + delta : body.x;
  const nz = axis === 'z' ? body.z + delta : body.z;
  if (!blocked(terrain, nx, nz, body.y)) {
    body[axis] += delta;
    return false;
  }
  const at = body[axis];
  // one tick never crosses more than one cell border, so the wall starts at the next one
  const flush = delta > 0 ? Math.floor(at + HALF_WIDTH + delta) - HALF_WIDTH - EPSILON : Math.floor(at - HALF_WIDTH + delta) + 1 + HALF_WIDTH + EPSILON;
  body[axis] = delta > 0 ? Math.max(at, Math.min(flush, at + delta)) : Math.min(at, Math.max(flush, at + delta));
  return true;
}

/** Sneaking on the ground backs a step off until it would not drop more than SNEAK_EDGE_DROP. */
function backOffEdge(terrain: Terrain, body: PhysicsBody, dx: number, dz: number): [number, number] {
  const falls = (mx: number, mz: number) => groundUnder(terrain, body.x + mx, body.z + mz) < body.y - SNEAK_EDGE_DROP;
  const shrink = (d: number) => (Math.abs(d) < SNEAK_EDGE_STEP ? 0 : d - Math.sign(d) * SNEAK_EDGE_STEP);
  while (dx !== 0 && falls(dx, 0)) dx = shrink(dx);
  while (dz !== 0 && falls(0, dz)) dz = shrink(dz);
  while (dx !== 0 && dz !== 0 && falls(dx, dz)) {
    dx = shrink(dx);
    dz = shrink(dz);
  }
  return [dx, dz];
}

function move(terrain: Terrain, body: PhysicsBody, sneak: boolean, maxHeight: number): void {
  let dx = body.vx;
  let dz = body.vz;
  if (sneak && body.onGround) [dx, dz] = backOffEdge(terrain, body, dx, dz);

  // vertical first, then x, then z, as the original does
  const floor = groundUnder(terrain, body.x, body.z);
  body.y += body.vy;
  if (body.y <= floor) {
    body.y = floor;
    body.onGround = body.vy <= 0;
    body.vy = 0;
  } else {
    body.onGround = false;
  }
  if (body.y > maxHeight) {
    body.y = maxHeight;
    body.vy = Math.min(body.vy, 0);
  }

  const hitX = moveAxis(terrain, body, 'x', dx);
  const hitZ = moveAxis(terrain, body, 'z', dz);
  if (hitX) body.vx = 0;
  if (hitZ) body.vz = 0;
  body.collidedHorizontally = hitX || hitZ;
  // walking off a ledge starts the fall from the next tick
  if (body.onGround && body.y > groundUnder(terrain, body.x, body.z) + EPSILON) body.onGround = false;
}

/** Pushes the body along its input, relative to the camera's heading. */
function applyHeading(body: PhysicsBody, input: PhysicsInput, strafe: number, forward: number, acceleration: number): void {
  const length = Math.hypot(strafe, forward);
  if (length < 0.01) return;
  const scale = acceleration / Math.max(length, 1);
  const s = strafe * scale;
  const f = forward * scale;
  // forward is (-sin yaw, -cos yaw) on the ground, right is (cos yaw, -sin yaw)
  body.vx += -Math.sin(input.yaw) * f + Math.cos(input.yaw) * s;
  body.vz += -Math.cos(input.yaw) * f - Math.sin(input.yaw) * s;
}

/** Whether a wall just walked into is one block a jump clears. */
function stepAhead(terrain: Terrain, body: PhysicsBody, input: PhysicsInput): boolean {
  const length = Math.hypot(input.forward, input.right);
  if (length < 0.1) return false;
  const dirX = (-Math.sin(input.yaw) * input.forward + Math.cos(input.yaw) * input.right) / length;
  const dirZ = (-Math.cos(input.yaw) * input.forward - Math.sin(input.yaw) * input.right) / length;
  const aheadX = body.x + dirX * (HALF_WIDTH + 0.2);
  const aheadZ = body.z + dirZ * (HALF_WIDTH + 0.2);
  if (terrain.isWater(aheadX, aheadZ)) return false;
  const rise = terrain.groundAt(aheadX, aheadZ) - body.y;
  return rise > EPSILON && rise <= 1 + EPSILON;
}

/** One tick of movement. */
export function stepBody(terrain: Terrain, body: PhysicsBody, input: PhysicsInput, maxHeight: number): void {
  if (Math.abs(body.vx) < NEGLIGIBLE_VELOCITY) body.vx = 0;
  if (Math.abs(body.vy) < NEGLIGIBLE_VELOCITY) body.vy = 0;
  if (Math.abs(body.vz) < NEGLIGIBLE_VELOCITY) body.vz = 0;

  const sprint = input.sprint && !input.sneak && input.forward > 0;
  const wantsJump = input.jump || (input.autoJump && body.onGround && body.collidedHorizontally && stepAhead(terrain, body, input));
  if (wantsJump) {
    if (body.jumpTicks > 0) body.jumpTicks--;
    if (body.onGround && body.jumpTicks === 0) {
      body.vy = JUMP_VELOCITY;
      if (sprint) {
        body.vx += -Math.sin(input.yaw) * SPRINT_JUMP_BOOST;
        body.vz += -Math.cos(input.yaw) * SPRINT_JUMP_BOOST;
      }
      body.jumpTicks = JUMP_COOLDOWN_TICKS;
    }
  } else {
    body.jumpTicks = 0;
  }

  let strafe = input.right * INPUT_SCALE;
  let forward = input.forward * INPUT_SCALE;
  if (input.sneak) {
    strafe *= SNEAK_MULTIPLIER;
    forward *= SNEAK_MULTIPLIER;
  }

  let inertia: number;
  let acceleration: number;
  if (body.onGround) {
    inertia = GROUND_INERTIA;
    const speed = WALK_SPEED * (sprint ? SPRINT_MULTIPLIER : 1);
    acceleration = speed * (0.1627714 / (inertia * inertia * inertia));
  } else {
    inertia = AIR_INERTIA;
    acceleration = AIR_ACCELERATION + (sprint ? AIR_SPRINT_ACCELERATION : 0);
  }
  applyHeading(body, input, strafe, forward, acceleration);
  move(terrain, body, input.sneak, maxHeight);

  body.vy = (body.vy - GRAVITY) * AIR_DRAG;
  body.vx *= inertia;
  body.vz *= inertia;
}
