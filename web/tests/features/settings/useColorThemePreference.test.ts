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
    saveColorTheme('black');
    expect(localStorage.getItem(KEY)).toBe('black');
    expect(loadColorTheme()).toBe('black');
  });

  it('falls back to linkord for a theme that was removed', () => {
    for (const removed of ['whatsapp', 'light']) {
      localStorage.setItem(KEY, removed);
      expect(loadColorTheme(), removed).toBe('linkord');
    }
  });

  it('falls back to linkord for unknown stored values', () => {
    localStorage.setItem(KEY, 'telegram');
    expect(loadColorTheme()).toBe('linkord');
  });
});
