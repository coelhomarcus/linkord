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
    saveColorTheme('old');
    expect(loadColorTheme()).toBe('old');
  });

  it('persists a valid theme id', () => {
    saveColorTheme('graphite');
    expect(localStorageStore.get(KEY)).toBe('graphite');
    expect(loadColorTheme()).toBe('graphite');
  });

  it('migrates the ids stored before the rename and writes the new one back', () => {
    for (const [legacy, current] of [['linkord', 'old'], ['discord', 'graphite']]) {
      localStorageStore.set(KEY, legacy);
      expect(loadColorTheme(), legacy).toBe(current);
      expect(localStorageStore.get(KEY), legacy).toBe(current);
    }
  });

  it('does not treat object prototype keys as legacy ids', () => {
    localStorageStore.set(KEY, 'constructor');
    expect(loadColorTheme()).toBe('black');
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
