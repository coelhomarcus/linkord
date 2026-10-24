import { afterEach, describe, expect, it } from 'vitest';
import { loadColorTheme, saveColorTheme } from '@/features/settings/useColorThemePreference';

const KEY = 'linkord.colorTheme';

describe('useColorThemePreference', () => {
  afterEach(() => {
    localStorage.removeItem(KEY);
  });

  it('defaults to linkord when unset', () => {
    expect(loadColorTheme()).toBe('linkord');
  });

  it('persists a valid theme id', () => {
    saveColorTheme('whatsapp');
    expect(localStorage.getItem(KEY)).toBe('whatsapp');
    expect(loadColorTheme()).toBe('whatsapp');
  });

  it('falls back to linkord for unknown stored values', () => {
    localStorage.setItem(KEY, 'telegram');
    expect(loadColorTheme()).toBe('linkord');
  });
});
