// How the local avatar moves: the block-game rules, stepped at their own 20
// ticks a second and drawn in between (PlaygroundEngine interpolates), so
// walking, sprinting, sneaking and jumping feel the way players expect: speed
// that builds up and slides off over a few ticks, a 1.25-block jump, a sprint
// jump that carries forward, a sneak that stops at edges.
//
// Ported from prismarine-physics (github.com/zardoy/prismarine-physics, MIT,
// Copyright (c) 2020 PrismarineJS): the body is a 0.6 × 1.8 box that collides
// with every solid block cell, one axis at a time, and stops flush against it.
// In water it swims the game's way: slow, sinking a little, Space swims up, and
// walking into the edge of a pool climbs out of it.

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
const KNOCKBACK_UP = 0.4;
const WATER_ACCELERATION = 0.02;
const WATER_DRAG = 0.8;
const WATER_GRAVITY = 0.02;
const SWIM_UP = 0.04;
/** walking into the side of a pool with room above lifts the body this fast, out of the water */
const CLIMB_OUT = 0.3;

export const HALF_WIDTH = 0.3;
export const BODY_HEIGHT = 1.8;
export const STANDING_EYE_HEIGHT = 1.62;
export const SNEAKING_EYE_HEIGHT = 1.27;
const EPSILON = 1e-7;

/** The world as the body collides with it: which block cells are solid (leaves too, as in the game). */
export interface Terrain {
  isSolid(x: number, y: number, z: number): boolean;
  isWater(x: number, y: number, z: number): boolean;
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
  /** how far it has dropped since it last stood on something (a punch on the way down is a critical) */
  fallDistance: number;
  /** in water this tick: it swims */
  inWater: boolean;
}

export function createBody(x: number, y: number, z: number): PhysicsBody {
  return { x, y, z, vx: 0, vy: 0, vz: 0, onGround: true, collidedHorizontally: false, jumpTicks: 0, fallDistance: 0, inWater: false };
}

/** A hit's knockback, the game's way: the speed halves, `push` is added across and 0.4 up (at most
 * 0.4 up in all), then a sprinting attacker's `extra`. Blocks per tick. */
export function applyKnockback(body: PhysicsBody, push: readonly [number, number], extra?: readonly [number, number, number]): void {
  body.vx = body.vx / 2 + push[0];
  body.vz = body.vz / 2 + push[1];
  body.vy = Math.min(KNOCKBACK_UP, body.vy / 2 + KNOCKBACK_UP);
  if (extra) {
    body.vx += extra[0];
    body.vy += extra[1];
    body.vz += extra[2];
  }
  body.onGround = false;
}

type Axis = 0 | 1 | 2;

/** The body's box: min and max corners, feet at y. */
interface Box { min: [number, number, number]; max: [number, number, number] }

function boxAt(x: number, y: number, z: number): Box {
  return { min: [x - HALF_WIDTH, y, z - HALF_WIDTH], max: [x + HALF_WIDTH, y + BODY_HEIGHT, z + HALF_WIDTH] };
}

/** The cells a span covers along one axis, its faces exactly on a border not counting. */
const cellsOf = (min: number, max: number): [number, number] => [Math.floor(min + EPSILON), Math.floor(max - EPSILON)];

/** Whether the body is in water, as the game tells: its box less 0.4 at the top and the bottom. */
function inWater(terrain: Terrain, body: PhysicsBody): boolean {
  const [x0, x1] = cellsOf(body.x - HALF_WIDTH + 0.001, body.x + HALF_WIDTH - 0.001);
  const [y0, y1] = cellsOf(body.y + 0.4, body.y + BODY_HEIGHT - 0.4);
  const [z0, z1] = cellsOf(body.z - HALF_WIDTH + 0.001, body.z + HALF_WIDTH - 0.001);
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) if (terrain.isWater(x, y, z)) return true;
  return false;
}

/** Whether any solid cell overlaps the box. */
function overlapsSolid(terrain: Terrain, box: Box): boolean {
  const [x0, x1] = cellsOf(box.min[0], box.max[0]);
  const [y0, y1] = cellsOf(box.min[1], box.max[1]);
  const [z0, z1] = cellsOf(box.min[2], box.max[2]);
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) if (terrain.isSolid(x, y, z)) return true;
  return false;
}

/** How far the box can move along `axis` (up to `delta`) before a solid cell stops it, flush against it. */
function sweep(terrain: Terrain, box: Box, axis: Axis, delta: number): number {
  if (delta === 0) return 0;
  const [a, b] = ([0, 1, 2] as Axis[]).filter((other) => other !== axis) as [Axis, Axis];
  const [a0, a1] = cellsOf(box.min[a], box.max[a]);
  const [b0, b1] = cellsOf(box.min[b], box.max[b]);
  const blocked = (cell: number) => {
    for (let i = a0; i <= a1; i++) {
      for (let j = b0; j <= b1; j++) {
        const at: [number, number, number] = [0, 0, 0];
        at[axis] = cell; at[a] = i; at[b] = j;
        if (terrain.isSolid(at[0], at[1], at[2])) return true;
      }
    }
    return false;
  };
  if (delta > 0) {
    const edge = box.max[axis];
    for (let cell = Math.floor(edge + EPSILON); cell <= Math.floor(edge + delta - EPSILON); cell++) {
      if (cell + EPSILON >= edge && blocked(cell)) return Math.max(0, cell - edge);
    }
  } else {
    const edge = box.min[axis];
    for (let cell = Math.floor(edge - EPSILON); cell >= Math.floor(edge + delta + EPSILON); cell--) {
      if (cell + 1 - EPSILON <= edge && blocked(cell)) return Math.min(0, cell + 1 - edge);
    }
  }
  return delta;
}

/** Sneaking on the ground backs a step off until it would not drop more than SNEAK_EDGE_DROP. */
function backOffEdge(terrain: Terrain, body: PhysicsBody, dx: number, dz: number): [number, number] {
  const falls = (mx: number, mz: number) => !overlapsSolid(terrain, boxAt(body.x + mx, body.y - SNEAK_EDGE_DROP, body.z + mz));
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
  const dy = sweep(terrain, boxAt(body.x, body.y, body.z), 1, body.vy);
  body.y += dy;
  body.onGround = body.vy < 0 && dy !== body.vy;
  if (body.onGround) body.fallDistance = 0;
  else if (dy < 0) body.fallDistance -= dy;
  if (dy !== body.vy) body.vy = 0;
  if (body.y > maxHeight) {
    body.y = maxHeight;
    body.vy = Math.min(body.vy, 0);
  }

  const mx = sweep(terrain, boxAt(body.x, body.y, body.z), 0, dx);
  body.x += mx;
  const mz = sweep(terrain, boxAt(body.x, body.y, body.z), 2, dz);
  body.z += mz;
  const hitX = mx !== dx;
  const hitZ = mz !== dz;
  if (hitX) body.vx = 0;
  if (hitZ) body.vz = 0;
  body.collidedHorizontally = hitX || hitZ;
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

/** Whether a wall just walked into is one block a jump clears: solid at the feet, free above it. */
function stepAhead(terrain: Terrain, body: PhysicsBody, input: PhysicsInput): boolean {
  const length = Math.hypot(input.forward, input.right);
  if (length < 0.1) return false;
  const dirX = (-Math.sin(input.yaw) * input.forward + Math.cos(input.yaw) * input.right) / length;
  const dirZ = (-Math.cos(input.yaw) * input.forward - Math.sin(input.yaw) * input.right) / length;
  const ahead = boxAt(body.x + dirX * 0.2, body.y, body.z + dirZ * 0.2);
  const step: Box = { min: [ahead.min[0], body.y, ahead.min[2]], max: [ahead.max[0], body.y + 1, ahead.max[2]] };
  const above: Box = { min: [ahead.min[0], body.y + 1, ahead.min[2]], max: [ahead.max[0], body.y + 1 + BODY_HEIGHT, ahead.max[2]] };
  return overlapsSolid(terrain, step) && !overlapsSolid(terrain, above);
}

/** One tick in water: Space swims up, the rest drifts slowly down. */
function swim(terrain: Terrain, body: PhysicsBody, input: PhysicsInput, maxHeight: number): void {
  body.fallDistance = 0;
  body.jumpTicks = 0;
  if (input.jump || input.autoJump) body.vy += SWIM_UP;
  let strafe = input.right * INPUT_SCALE;
  let forward = input.forward * INPUT_SCALE;
  if (input.sneak) {
    strafe *= SNEAK_MULTIPLIER;
    forward *= SNEAK_MULTIPLIER;
  }
  applyHeading(body, input, strafe, forward, WATER_ACCELERATION);
  const startY = body.y;
  move(terrain, body, false, maxHeight);
  body.vx *= WATER_DRAG;
  body.vy *= WATER_DRAG;
  body.vz *= WATER_DRAG;
  body.vy -= WATER_GRAVITY;
  // against the side of a pool, with room above: out of the water
  if (body.collidedHorizontally) {
    const lifted = boxAt(body.x + body.vx, body.y + body.vy + 0.6 - body.y + startY, body.z + body.vz);
    if (!overlapsSolid(terrain, lifted)) body.vy = CLIMB_OUT;
  }
}

/** One tick of movement. */
export function stepBody(terrain: Terrain, body: PhysicsBody, input: PhysicsInput, maxHeight: number): void {
  if (Math.abs(body.vx) < NEGLIGIBLE_VELOCITY) body.vx = 0;
  if (Math.abs(body.vy) < NEGLIGIBLE_VELOCITY) body.vy = 0;
  if (Math.abs(body.vz) < NEGLIGIBLE_VELOCITY) body.vz = 0;

  body.inWater = inWater(terrain, body);
  if (body.inWater) {
    swim(terrain, body, input, maxHeight);
    return;
  }

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
