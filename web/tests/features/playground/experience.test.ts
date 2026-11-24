import { describe, expect, it } from 'vitest';
import { experienceLevel } from '@/features/playground/experience';

describe('experienceLevel', () => {
  it('counts levels with the game\'s curve', () => {
    expect(experienceLevel(0)).toEqual({ level: 0, progress: 0 });
    expect(experienceLevel(7)).toEqual({ level: 1, progress: 0 });
    expect(experienceLevel(7 + 4.5).level).toBe(1);
    expect(experienceLevel(7 + 9 / 3 * 2)).toMatchObject({ level: 1 });
    expect(experienceLevel(315).level).toBe(15);
    expect(experienceLevel(1395).level).toBe(30);
  });
});
