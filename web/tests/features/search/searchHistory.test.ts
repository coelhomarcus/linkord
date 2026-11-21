import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { clearSearchHistory, rememberSearch, useSearchHistory } from '@/features/search/searchHistory';
import { EMPTY_QUERY } from '@/features/search/searchQuery';
import { clearResourceCaches } from '@/shared/lib/resourceCache';

afterEach(() => clearResourceCaches());

describe('search history', () => {
  it('keeps the newest search first, once, per server or DM', () => {
    const { result } = renderHook(() => useSearchHistory('s1'));
    act(() => {
      rememberSearch('s1', { ...EMPTY_QUERY, text: 'a' });
      rememberSearch('s1', { ...EMPTY_QUERY, text: 'b' });
      rememberSearch('s1', { ...EMPTY_QUERY, text: 'A' });
      rememberSearch('s2', { ...EMPTY_QUERY, text: 'other' });
    });
    expect(result.current.map((q) => q.text)).toEqual(['A', 'b']);
    act(() => clearSearchHistory('s1'));
    expect(result.current).toEqual([]);
  });

  it('is forgotten on sign-out', () => {
    act(() => rememberSearch('s1', { ...EMPTY_QUERY, text: 'a' }));
    act(() => clearResourceCaches());
    const { result } = renderHook(() => useSearchHistory('s1'));
    expect(result.current).toEqual([]);
    expect(window.localStorage.getItem('ss-search-history:s1')).toBeNull();
  });
});
