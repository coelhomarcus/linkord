import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_STORAGE_KEYS, localStorageStore } from '@/shared/lib/localStorage';

describe('localStorageStore', () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('reads, writes, and removes values using the key catalog', () => {
    localStorageStore.set(LOCAL_STORAGE_KEYS.language, 'pt-BR');
    expect(localStorageStore.get(LOCAL_STORAGE_KEYS.language)).toBe('pt-BR');

    localStorageStore.remove(LOCAL_STORAGE_KEYS.language);
    expect(localStorageStore.get(LOCAL_STORAGE_KEYS.language)).toBeNull();
  });

  it('returns null for missing keys', () => {
    expect(localStorageStore.get(LOCAL_STORAGE_KEYS.language)).toBeNull();
  });

  it('treats unavailable storage as best-effort', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked'); });

    expect(localStorageStore.get(LOCAL_STORAGE_KEYS.language)).toBeNull();
    expect(() => localStorageStore.set(LOCAL_STORAGE_KEYS.language, 'en-US')).not.toThrow();
    expect(() => localStorageStore.remove(LOCAL_STORAGE_KEYS.language)).not.toThrow();
  });
});
