import { describe, expect, it } from 'vitest';
import { shouldCompensateResize } from '@/features/chat/scrollCompensation';

// scrollOffset 1000: the fold. A row whose bottom is at or above it is
// entirely out of sight; one that starts above and ends below spans it.
const fold = 1000;
const above = { itemStart: 600, itemEnd: 900 };
const spanning = { itemStart: 900, itemEnd: 1200 };
const below = { itemStart: 1100, itemEnd: 1300 };

describe('shouldCompensateResize', () => {
  it('keeps the reader in place when an already measured row above the fold grows, scrolling either way', () => {
    expect(shouldCompensateResize({ ...above, isFirstMeasure: false, scrollOffset: fold })).toBe(true);
  });

  it('leaves a row that spans the fold alone: it grows below the reader', () => {
    expect(shouldCompensateResize({ ...spanning, isFirstMeasure: false, scrollOffset: fold })).toBe(false);
  });

  it('leaves a row below the fold alone', () => {
    expect(shouldCompensateResize({ ...below, isFirstMeasure: false, scrollOffset: fold })).toBe(false);
  });

  it('corrects the first measurement of any row that starts above the fold, spanning it included', () => {
    expect(shouldCompensateResize({ ...above, isFirstMeasure: true, scrollOffset: fold })).toBe(true);
    expect(shouldCompensateResize({ ...spanning, isFirstMeasure: true, scrollOffset: fold })).toBe(true);
    expect(shouldCompensateResize({ ...below, isFirstMeasure: true, scrollOffset: fold })).toBe(false);
  });
});
