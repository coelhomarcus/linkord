import { afterEach, describe, expect, it } from 'vitest';
import { loadColorTheme, saveColorTheme } from '@/features/settings/useColorThemePreference';

const KEY = 'linkord.colorTheme';

describe('useColorThemePreference', () => {
  afterEach(() => {
    localStorage.removeItem(KEY);
  });

  it('defaults to black when unset', () => {
    expect(loadColorTheme()).toBe('black');
  });

  it('keeps a saved Old theme, the default before Black took over', () => {
    saveColorTheme('linkord');
    expect(loadColorTheme()).toBe('linkord');
  });

  it('persists a valid theme id', () => {
    saveColorTheme('discord');
    expect(localStorage.getItem(KEY)).toBe('discord');
    expect(loadColorTheme()).toBe('discord');
  });

  it('falls back to black for a theme that was removed', () => {
    for (const removed of ['whatsapp', 'light']) {
      localStorage.setItem(KEY, removed);
      expect(loadColorTheme(), removed).toBe('black');
    }
  });

  it('falls back to black for unknown stored values', () => {
    localStorage.setItem(KEY, 'telegram');
    expect(loadColorTheme()).toBe('black');
  });
});
