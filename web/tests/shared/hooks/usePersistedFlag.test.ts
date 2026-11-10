import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { usePersistedFlag } from '@/shared/hooks/usePersistedFlag';
import { LOCAL_STORAGE_KEYS } from '@/shared/lib/localStorage';
import type { LocalStorageKey } from '@/shared/lib/localStorage';

const COLUMN = LOCAL_STORAGE_KEYS.memberListOpen as LocalStorageKey;
const OVERLAY = LOCAL_STORAGE_KEYS.memberListOverlayOpen as LocalStorageKey;

describe('usePersistedFlag', () => {
  afterEach(() => localStorage.clear());

  it('uses the fallback until something is saved, and ignores values it did not write', () => {
    expect(renderHook(() => usePersistedFlag(COLUMN, true)).result.current[0]).toBe(true);
    localStorage.setItem(COLUMN, 'invalid');
    expect(renderHook(() => usePersistedFlag(COLUMN, false)).result.current[0]).toBe(false);
  });

  it('saves what is set, so the next mount reads it back', () => {
    const { result } = renderHook(() => usePersistedFlag(COLUMN, true));
    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);
    expect(localStorage.getItem(COLUMN)).toBe('0');
    expect(renderHook(() => usePersistedFlag(COLUMN, true)).result.current[0]).toBe(false);
  });

  it('keeps each key apart when the key changes', () => {
    const { result, rerender } = renderHook(({ key, fallback }: { key: LocalStorageKey; fallback: boolean }) => usePersistedFlag(key, fallback), {
      initialProps: { key: COLUMN, fallback: true },
    });
    act(() => result.current[1](false));

    rerender({ key: OVERLAY, fallback: false });
    expect(result.current[0]).toBe(false);
    act(() => result.current[1](true));

    rerender({ key: COLUMN, fallback: true });
    expect(result.current[0]).toBe(false);
    rerender({ key: OVERLAY, fallback: false });
    expect(result.current[0]).toBe(true);
  });
});
