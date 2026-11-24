// How a person's box model moves: legs and arms swinging with the distance
// walked, arms breathing while still, the right arm's punch, the sneak's bend,
// the right hand brought to the mouth to eat, and a body that turns toward
// where it walks while the head turns toward where it looks. The angles and offsets are the block game's humanoid model
// (as minecraft-renderer, github.com/zardoy/minecraft-web-client, MIT,
// Copyright (c) 2020 PrismarineJS, reproduces them), converted from its model
// space (y down, facing -z) to ours (y up, facing +z): x rotations keep their
// sign, y and z rotations and z positions flip, and heights count from the feet.

/** Pixels of the skin's 32-pixel-tall model; BlockAvatar scales them. */
type Vec3Px = [number, number, number];

interface PartPose {
  /** pivot, in pixels from the feet */
  position: Vec3Px;
  /** radians, applied z, then y, then x */
  rotation: Vec3Px;
}

export interface BipedPose {
  head: PartPose;
  body: PartPose;
  rightArm: PartPose;
  leftArm: PartPose;
  rightLeg: PartPose;
  leftLeg: PartPose;
  /** how far the whole model sits lower, in pixels (a sneak) */
  drop: number;
}

export interface PoseInput {
  /** distance walked, in the game's limb-swing units (see LimbSwing) */
  limbSwing: number;
  /** 0..1, how strongly the limbs swing right now */
  limbAmount: number;
  /** seconds alive, for the idle breathing of the arms */
  age: number;
  /** head yaw relative to the body, radians, positive turns toward +x */
  headYaw: number;
  /** positive looks up */
  headPitch: number;
  crouching: boolean;
  /** 0..1 through a punch, or 0 when not punching */
  attack: number;
  slim: boolean;
  /** the right hand holds something: the arm is raised a little and swings half as much */
  holding?: boolean;
  /** eating it: the hand goes to the mouth and bobs there */
  eating?: boolean;
}

const LIMB_FREQUENCY = 0.6662;
const LEG_AMPLITUDE = 1.4;
const TICKS_PER_SECOND = 20;

/** Our model space from the original's: a pivot (x, y-down from the neck, z) in pixels. */
const at = (x: number, yDown: number, z: number): Vec3Px => [x, 24 - yDown, -z];

export function bipedPose(input: PoseInput): BipedPose {
  const { limbSwing: ls, limbAmount: la } = input;
  const armY = input.slim ? 2.5 : 2;
  // everything below is in the original's model space, converted on the way out
  const head = { x: 0, y: 0, z: 0, xRot: -input.headPitch, yRot: -input.headYaw, zRot: 0 };
  const body = { x: 0, y: 0, z: 0, xRot: 0, yRot: 0, zRot: 0 };
  const rightArm = { x: -5, y: armY, z: 0, xRot: Math.cos(ls * LIMB_FREQUENCY + Math.PI) * 2 * la * 0.5, yRot: 0, zRot: 0 };
  const leftArm = { x: 5, y: armY, z: 0, xRot: Math.cos(ls * LIMB_FREQUENCY) * 2 * la * 0.5, yRot: 0, zRot: 0 };
  const rightLeg = { x: -1.9, y: 12, z: 0.1, xRot: Math.cos(ls * LIMB_FREQUENCY) * LEG_AMPLITUDE * la, yRot: 0, zRot: 0 };
  const leftLeg = { x: 1.9, y: 12, z: 0.1, xRot: Math.cos(ls * LIMB_FREQUENCY + Math.PI) * LEG_AMPLITUDE * la, yRot: 0, zRot: 0 };

  // the game's ArmPose.ITEM
  if (input.holding) rightArm.xRot = rightArm.xRot * 0.5 - Math.PI / 10;
  // up and in to the mouth, following the head's pitch, bobbing four ticks a beat as the first-person food does
  if (input.eating) {
    const ticks = input.age * TICKS_PER_SECOND;
    rightArm.xRot = head.xRot - 1.35 + Math.abs(Math.cos((ticks / 4) * Math.PI)) * 0.15;
    rightArm.yRot = -0.45;
  }

  if (input.attack > 0) {
    const t = input.attack;
    body.yRot = Math.sin(Math.sqrt(t) * Math.PI * 2) * 0.2;
    rightArm.z = Math.sin(body.yRot) * 5;
    rightArm.x = -Math.cos(body.yRot) * 5;
    leftArm.z = -Math.sin(body.yRot) * 5;
    leftArm.x = Math.cos(body.yRot) * 5;
    rightArm.yRot += body.yRot;
    leftArm.yRot += body.yRot;
    leftArm.xRot += body.yRot;
    let f = 1 - t;
    f *= f;
    f *= f;
    f = 1 - f;
    const lift = Math.sin(f * Math.PI);
    const aim = Math.sin(t * Math.PI) * -(head.xRot - 0.7) * 0.75;
    rightArm.xRot -= lift * 1.2 + aim;
    rightArm.yRot += body.yRot * 2;
    rightArm.zRot += Math.sin(t * Math.PI) * -0.4;
  }

  if (input.crouching) {
    body.xRot = 0.5;
    rightArm.xRot += 0.4;
    leftArm.xRot += 0.4;
    rightLeg.z = 4;
    leftLeg.z = 4;
    rightLeg.y = 12.2;
    leftLeg.y = 12.2;
    head.y = 4.2;
    body.y = 3.2;
    leftArm.y = 5.2;
    rightArm.y = 5.2;
  }

  // the arms breathe a little, always
  const ticks = input.age * TICKS_PER_SECOND;
  const breathe = Math.cos(ticks * 0.09) * 0.05 + 0.05;
  rightArm.zRot += breathe;
  leftArm.zRot -= breathe;
  rightArm.xRot += Math.sin(ticks * 0.067) * 0.05;
  leftArm.xRot -= Math.sin(ticks * 0.067) * 0.05;

  const convert = (part: typeof head): PartPose => ({ position: at(part.x, part.y, part.z), rotation: [part.xRot, -part.yRot, -part.zRot] });
  return {
    head: convert(head),
    body: convert(body),
    rightArm: convert(rightArm),
    leftArm: convert(leftArm),
    rightLeg: convert(rightLeg),
    leftLeg: convert(leftLeg),
    drop: input.crouching ? 2 : 0,
  };
}

/** The limb swing of the original: grows toward the distance covered each
 * tick, and advances by itself, so legs slow down and settle when stopping. */
export class LimbSwing {
  position = 0;
  amount = 0;

  /** `speed` in blocks per second, over `dt` seconds. */
  update(speed: number, dt: number): void {
    const ticks = dt * TICKS_PER_SECOND;
    const target = Math.min((speed / TICKS_PER_SECOND) * 4, 1);
    this.amount += (target - this.amount) * (1 - Math.pow(0.6, ticks));
    this.position += this.amount * ticks;
  }
}

const DEG = Math.PI / 180;
const MAX_HEAD_TURN = 50 * DEG;
const BACKWARD_MIN = 95 * DEG;

/** The signed shortest turn from one heading to another. */
export function angleDelta(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

/** One tick of the body following the head: toward where it walks (or straight
 * ahead when walking backwards or punching), never more than 50° from the head.
 * Headings are radians where 0 faces +z. Returns the new body heading. */
export function turnBody(body: number, head: number, movedX: number, movedZ: number, attacking: boolean): number {
  let target = body;
  if (movedX * movedX + movedZ * movedZ > 0.0025) {
    target = Math.atan2(movedX, movedZ);
    if (Math.abs(angleDelta(head, target)) > BACKWARD_MIN) target += Math.PI;
  }
  if (attacking) target = head;
  let next = body + angleDelta(body, target) * 0.3;
  const off = angleDelta(next, head);
  if (Math.abs(off) > MAX_HEAD_TURN) next += off - Math.sign(off) * MAX_HEAD_TURN;
  return next;
}
