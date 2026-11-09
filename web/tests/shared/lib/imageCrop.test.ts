import { describe, expect, it } from 'vitest';
import { cropParam } from '@/shared/lib/imageCrop';

describe('cropParam', () => {
  it('rounds to whole pixels and never goes below zero', () => {
    expect(cropParam({ x: -0.4, y: 1.5, width: 99.5, height: 100 })).toBe('0,2,100,100');
  });
});
