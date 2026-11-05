import { afterEach, describe, expect, it } from 'vitest';
import { loadColorTheme, saveColorTheme } from '@/features/settings/useColorThemePreference';
import { LOCAL_STORAGE_KEYS, localStorageStore } from '@/shared/lib/localStorage';

const KEY = LOCAL_STORAGE_KEYS.colorTheme;

describe('useColorThemePreference', () => {
  afterEach(() => {
    localStorageStore.remove(KEY);
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
    expect(localStorageStore.get(KEY)).toBe('discord');
    expect(loadColorTheme()).toBe('discord');
  });

  it('falls back to black for a theme that was removed', () => {
    for (const removed of ['whatsapp', 'light']) {
      localStorageStore.set(KEY, removed);
      expect(loadColorTheme(), removed).toBe('black');
    }
  });

  it('falls back to black for unknown stored values', () => {
    localStorageStore.set(KEY, 'telegram');
    expect(loadColorTheme()).toBe('black');
  });
});
