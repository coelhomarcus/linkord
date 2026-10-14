import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useLoadingPhase } from '@/features/friends/useLoadingPhase';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useLoadingPhase', () => {
  it('a view that opens loading shows the skeleton on its very first render', () => {
    const { result } = renderHook(() => useLoadingPhase(true));
    expect(result.current).toBe('skeleton');
  });

  it('a quick answer still keeps the skeleton up for its minimum time', () => {
    const { result, rerender } = renderHook(({ loading }) => useLoadingPhase(loading), { initialProps: { loading: true } });
    act(() => { vi.advanceTimersByTime(50); });
    rerender({ loading: false });
    expect(result.current).toBe('skeleton');
    act(() => { vi.advanceTimersByTime(300); });
    expect(result.current).toBe('content');
  });

  it('a view restored with its data never shows the skeleton', () => {
    const { result } = renderHook(() => useLoadingPhase(false));
    expect(result.current).toBe('content');
  });

  it('a later load (a new search) goes straight to the skeleton too', () => {
    const { result, rerender } = renderHook(({ loading }) => useLoadingPhase(loading), { initialProps: { loading: false } });
    rerender({ loading: true });
    expect(result.current).toBe('skeleton');
  });
});
