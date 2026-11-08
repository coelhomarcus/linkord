import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AVATAR_COLOR_OPTIONS } from '@/shared/Avatar';
import { PRESET_OKLCH, hexOf, presetHex } from '@/features/profile/avatarPresets';

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
