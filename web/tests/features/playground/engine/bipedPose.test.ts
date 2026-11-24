import { describe, expect, it } from 'vitest';
import { angleDelta, bipedPose, LimbSwing, turnBody } from '@/features/playground/engine/bipedPose';
import type { PoseInput } from '@/features/playground/engine/bipedPose';

const still: PoseInput = { limbSwing: 0, limbAmount: 0, age: 0, headYaw: 0, headPitch: 0, crouching: false, attack: 0, slim: false };
const DEG = Math.PI / 180;

describe('bipedPose', () => {
  it('stands with the pivots of the humanoid model', () => {
    const pose = bipedPose(still);
    expect(pose.head.position).toEqual([0, 24, -0]);
    expect(pose.rightArm.position).toEqual([-5, 22, -0]);
    expect(pose.rightLeg.position[0]).toBe(-1.9);
    expect(pose.rightLeg.position[1]).toBe(12);
    expect(pose.rightLeg.rotation[0]).toBe(0);
    expect(pose.drop).toBe(0);
  });

  it('swings opposite legs and arms against each other while walking', () => {
    const pose = bipedPose({ ...still, limbSwing: 1, limbAmount: 1 });
    expect(pose.rightLeg.rotation[0]).toBeCloseTo(-pose.leftLeg.rotation[0]);
    expect(Math.sign(pose.rightArm.rotation[0])).toBe(-Math.sign(pose.rightLeg.rotation[0]));
  });

  it('turns and tilts the head where it looks', () => {
    const pose = bipedPose({ ...still, headYaw: 0.4, headPitch: 0.3 });
    expect(pose.head.rotation[1]).toBeCloseTo(0.4);
    expect(pose.head.rotation[0]).toBeCloseTo(-0.3);
  });

  it('bends forward and sinks while sneaking', () => {
    const pose = bipedPose({ ...still, crouching: true });
    expect(pose.body.rotation[0]).toBe(0.5);
    expect(pose.head.position[1]).toBeCloseTo(19.8);
    expect(pose.drop).toBeGreaterThan(0);
  });

  it('holds the right arm a little forward while it holds something, swinging half as much', () => {
    expect(bipedPose({ ...still, holding: true }).rightArm.rotation[0]).toBeCloseTo(-Math.PI / 10);
    expect(bipedPose({ ...still, holding: true }).leftArm.rotation[0]).toBeCloseTo(bipedPose(still).leftArm.rotation[0]);
    const walking = { ...still, limbSwing: 0, limbAmount: 1 };
    const swing = bipedPose(walking).rightArm.rotation[0];
    expect(bipedPose({ ...walking, holding: true }).rightArm.rotation[0]).toBeCloseTo(swing * 0.5 - Math.PI / 10);
  });

  it('raises the right arm forward through a punch', () => {
    expect(bipedPose({ ...still, attack: 0.5 }).rightArm.rotation[0]).toBeLessThan(bipedPose(still).rightArm.rotation[0] - 0.5);
  });

  it('brings the right hand up and in to the mouth to eat, higher when looking up', () => {
    const eating = bipedPose({ ...still, holding: true, eating: true }).rightArm.rotation;
    expect(eating[0]).toBeLessThan(-1.2);
    // turned in toward the middle (y and z flip into our space)
    expect(eating[1]).toBeGreaterThan(0.4);
    expect(bipedPose({ ...still, holding: true, eating: true, headPitch: 0.5 }).rightArm.rotation[0]).toBeLessThan(eating[0]);
  });
});

describe('LimbSwing', () => {
  it('builds up with speed and settles when stopping', () => {
    const limbs = new LimbSwing();
    for (let i = 0; i < 20; i++) limbs.update(4.3, 0.05);
    expect(limbs.amount).toBeGreaterThan(0.8);
    for (let i = 0; i < 40; i++) limbs.update(0, 0.05);
    expect(limbs.amount).toBeLessThan(0.01);
  });
});

describe('turnBody', () => {
  it('keeps the body within 50° of the head', () => {
    const body = turnBody(0, 90 * DEG, 0, 0, false);
    expect(angleDelta(body, 90 * DEG)).toBeCloseTo(50 * DEG);
  });

  it('turns toward where it walks, but faces forward walking backwards', () => {
    let body = 0;
    for (let i = 0; i < 30; i++) body = turnBody(body, 20 * DEG, 0.2, 0.2, false);
    expect(body).toBeCloseTo(45 * DEG, 2);
    body = 0;
    for (let i = 0; i < 30; i++) body = turnBody(body, 0, 0, -0.2, false);
    expect(Math.abs(angleDelta(body, 0))).toBeLessThan(0.01);
  });
});
