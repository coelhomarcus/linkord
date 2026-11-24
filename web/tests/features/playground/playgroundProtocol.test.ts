import { describe, expect, it } from 'vitest';
import { decodeState, encodeState } from '@/features/playground/playgroundProtocol';
import { MAX_HEIGHT, WORLD_RADIUS } from '@/features/playground/playgroundWorld';

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

describe('playgroundProtocol', () => {
  it('round-trips a state, to the centimetre', () => {
    const decoded = decodeState(encodeState({ x: 1.234, y: 0.5, z: -7.891, yaw: 3.14159, motion: 'run' }));
    expect(decoded).toEqual({ x: 1.23, y: 0.5, z: -7.89, yaw: 3.14, motion: 'run' });
  });

  it('keeps a peer inside the world, whatever it claims', () => {
    const far = decodeState(bytes({ v: 1, p: [WORLD_RADIUS * 10, 99, 0], r: 0, m: 0 }))!;
    expect(Math.hypot(far.x, far.z)).toBeCloseTo(WORLD_RADIUS);
    expect(far.y).toBe(MAX_HEIGHT);
    expect(decodeState(bytes({ v: 1, p: [0, -5, 0], r: 0, m: 0 }))!.y).toBe(0);
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
