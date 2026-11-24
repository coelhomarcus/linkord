import { describe, expect, it } from 'vitest';
import { HEARING, proximityGain } from '@/features/playground/proximity';

describe('proximityGain', () => {
  it('is full volume up close and silent far away', () => {
    expect(proximityGain(0)).toBe(1);
    expect(proximityGain(HEARING.full)).toBe(1);
    expect(proximityGain(HEARING.silent)).toBe(0);
    expect(proximityGain(HEARING.silent * 3)).toBe(0);
  });

  it('fades steadily in between', () => {
    const near = proximityGain(HEARING.full + 2);
    const mid = proximityGain((HEARING.full + HEARING.silent) / 2);
    const far = proximityGain(HEARING.silent - 2);
    expect(near).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(far);
    expect(far).toBeGreaterThan(0);
    // halfway sounds quieter than half: loudness is heard on a curve
    expect(mid).toBeLessThan(0.5);
  });

  it('plays someone at an unknown distance at full volume', () => {
    expect(proximityGain(Number.NaN)).toBe(1);
  });
});
