import { describe, expect, it } from 'vitest';
import { decodeState, encodeState } from '@/features/playground/playgroundProtocol';
import { MAX_HEIGHT, WORLD_RADIUS } from '@/features/playground/playgroundWorld';

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

describe('playgroundProtocol', () => {
  it('round-trips a state, to the centimetre', () => {
    const decoded = decodeState(encodeState({ x: 1.234, y: 0.5, z: -7.891, yaw: 3.14159, pitch: -0.456, motion: 'run', headYaw: 2.5, crouch: true, swings: 257 }));
    expect(decoded).toEqual({ x: 1.23, y: 0.5, z: -7.89, yaw: 3.14, pitch: -0.46, motion: 'run', headYaw: 2.5, crouch: true, swings: 1 });
  });

  it('reads a packet from an older tab as a head facing the body, standing, never swinging', () => {
    expect(decodeState(bytes({ v: 1, p: [0, 0, 0], r: 1.5, m: 1 }))).toMatchObject({ headYaw: 1.5, crouch: false, swings: 0 });
  });

  it('keeps a peer inside the world, whatever it claims', () => {
    const far = decodeState(bytes({ v: 1, p: [WORLD_RADIUS * 10, 99, -WORLD_RADIUS * 3], r: 0, h: 9, m: 0 }))!;
    expect(far.x).toBe(WORLD_RADIUS);
    expect(far.z).toBe(-WORLD_RADIUS);
    expect(far.y).toBe(MAX_HEIGHT);
    expect(far.pitch).toBeCloseTo(Math.PI / 2);
    expect(decodeState(bytes({ v: 1, p: [0, -5, 0], r: 0, m: 0 }))!.y).toBe(0);
  });

  it('reads a packet without a head pitch as looking straight ahead', () => {
    expect(decodeState(bytes({ v: 1, p: [0, 0, 0], r: 0, m: 1 }))!.pitch).toBe(0);
  });

  it('reads an unknown motion as standing still', () => {
    expect(decodeState(bytes({ v: 1, p: [0, 0, 0], r: 0, m: 42 }))!.motion).toBe('idle');
  });

  it('ignores anything that is not a packet of this version', () => {
    expect(decodeState(new TextEncoder().encode('not json'))).toBeNull();
    expect(decodeState(bytes({ v: 2, p: [0, 0, 0], r: 0, m: 0 }))).toBeNull();
    expect(decodeState(bytes({ v: 1, p: [0, 'x', 0], r: 0, m: 0 }))).toBeNull();
    expect(decodeState(bytes({ v: 1, p: [0, 0], r: 0, m: 0 }))).toBeNull();
    expect(decodeState(bytes({ v: 1, p: [0, 0, 0], r: null, m: 0 }))).toBeNull();
    expect(decodeState(new Uint8Array(1024))).toBeNull();
  });
});
