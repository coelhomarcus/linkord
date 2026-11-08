import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AVATAR_COLOR_OPTIONS } from '@/shared/Avatar';
import { PRESET_OKLCH, hexOf, presetHex } from '@/features/profile/avatarPresets';
import { contrastOn, hexToHsv, hexToOklch, hsvToHex, oklchToHex, parseHex } from '@/features/profile/colorMath';

describe('colour conversions', () => {
  it('reads a hex colour with or without #, short or long, and nothing else', () => {
    expect(parseHex('#A1B2C3')).toBe('#a1b2c3');
    expect(parseHex('a1b2c3')).toBe('#a1b2c3');
    expect(parseHex('#fa0')).toBe('#ffaa00');
    for (const bad of ['', '#', '#12', '#1234', '#ggg', 'red', '#1234567']) expect(parseHex(bad)).toBeNull();
  });
  it('goes from hex to HSV and back without drifting', () => {
    for (const hex of ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#a1b2c3', '#123456', '#808080']) expect(hsvToHex(hexToHsv(hex))).toBe(hex);
    expect(hexToHsv('#ff0000')).toEqual({ h: 0, s: 1, v: 1 });
    expect(hexToHsv('#00ff00').h).toBe(120);
    expect(hsvToHex({ h: 240, s: 1, v: 1 })).toBe('#0000ff');
  });
  it('turns OKLCH into the matching sRGB colour', () => {
    expect(oklchToHex(1, 0, 0)).toBe('#ffffff');
    expect(oklchToHex(0, 0, 0)).toBe('#000000');
    // the reference value of pure red in OKLCH
    expect(oklchToHex(0.627955, 0.257683, 29.234)).toBe('#ff0000');
  });
  it('reads a hex colour back into OKLCH', () => {
    for (const [l, c, h] of [[0.55, 0.15, 275], [0.7, 0.1, 40], [0.3, 0.05, 150]] as const) {
      const back = hexToOklch(oklchToHex(l, c, h));
      expect(back.l).toBeCloseTo(l, 2);
      expect(back.c).toBeCloseTo(c, 2);
      // the 8-bit round trip moves the hue by a fraction of a degree
      expect(Math.abs(back.h - h)).toBeLessThan(1.5);
    }
    expect(hexToOklch('#ffffff').l).toBeCloseTo(1, 3);
  });
  it('picks a readable tick colour for a swatch', () => {
    expect(contrastOn('#ffffff')).toBe('#000000');
    expect(contrastOn('#ffff00')).toBe('#000000');
    expect(contrastOn('#1e3a8a')).toBe('#ffffff');
  });
});

const css = readFileSync(resolve(__dirname, '../../../src/styles/index.css'), 'utf8');

describe('avatar presets', () => {
  it('are the colours the stylesheet defines, so the cursor lands where the swatch is', () => {
    const variable = (option: (typeof AVATAR_COLOR_OPTIONS)[number]) => option.css.match(/--[\w-]+/)![0];
    for (const option of AVATAR_COLOR_OPTIONS) {
      const match = new RegExp(`${variable(option)}:\\s*oklch\\(([\\d.]+)%\\s+([\\d.]+)\\s+([\\d.]+)\\)`).exec(css);
      expect(match, option.value).not.toBeNull();
      const [l, c, h] = PRESET_OKLCH[option.value];
      expect([l, c, h]).toEqual([Number(match![1]) / 100, Number(match![2]), Number(match![3])]);
    }
  });
  it('turn a stored value, preset or hex, into hex', () => {
    expect(hexOf('#A1B2C3')).toBe('#a1b2c3');
    expect(hexOf('green')).toBe(presetHex('green'));
    expect(hexOf('nonsense')).toBe(presetHex('blurple'));
  });
});
