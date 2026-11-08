import { describe, expect, it } from 'vitest';
import { isTooDarkForAccent, MIN_ACCENT_LIGHTNESS, readableAccent } from '@/features/profile/accentColor';
import { hexToOklch, withMinLightness } from '@/features/profile/colorMath';

describe('readable accent', () => {
  it('lightens a colour too dark for the dark surfaces of the Wall, keeping its hue', () => {
    const lifted = readableAccent('#522935');
    expect(hexToOklch(lifted).l).toBeGreaterThanOrEqual(MIN_ACCENT_LIGHTNESS - 0.01);
    expect(Math.abs(hexToOklch(lifted).h - hexToOklch('#522935').h)).toBeLessThan(3);
  });
  it('turns black into a visible grey', () => {
    const grey = readableAccent('#000000');
    expect(hexToOklch(grey).l).toBeGreaterThanOrEqual(MIN_ACCENT_LIGHTNESS - 0.01);
    expect(hexToOklch(grey).c).toBeLessThan(0.01);
  });
  it('leaves colours that already read, and the presets, exactly as they are', () => {
    for (const hex of ['#ff8800', '#ffffff', '#5a66c7']) expect(readableAccent(hex)).toBe(hex);
    expect(readableAccent('var(--color-avatar-green)')).toBe('var(--color-avatar-green)');
  });
  it('gives up chroma, not hue, where the lighter colour falls outside sRGB', () => {
    const lifted = withMinLightness('#0000ff', 0.9);
    expect(hexToOklch(lifted).l).toBeGreaterThan(0.88);
    expect(Math.abs(hexToOklch(lifted).h - hexToOklch('#0000ff').h)).toBeLessThan(5);
  });
  it('tells the picker which colours will be lightened', () => {
    expect(isTooDarkForAccent('#000000')).toBe(true);
    expect(isTooDarkForAccent('#522935')).toBe(true);
    expect(isTooDarkForAccent('#ff8800')).toBe(false);
    expect(isTooDarkForAccent('green')).toBe(false);
  });
});
