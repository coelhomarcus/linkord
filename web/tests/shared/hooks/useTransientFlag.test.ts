import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTransientFlag } from '@/shared/hooks/useTransientFlag';

describe('useTransientFlag', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('turns itself off after the duration', () => {
    const { result } = renderHook(() => useTransientFlag(1000));
    expect(result.current[0]).toBe(false);

    act(() => result.current[1]());
    expect(result.current[0]).toBe(true);

    act(() => { vi.advanceTimersByTime(999); });
    expect(result.current[0]).toBe(true);
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current[0]).toBe(false);
  });

  it('restarts the wait when raised again while on', () => {
    const { result } = renderHook(() => useTransientFlag(1000));
    act(() => result.current[1]());
    act(() => { vi.advanceTimersByTime(800); });
    act(() => result.current[1]());
    act(() => { vi.advanceTimersByTime(800); });
    expect(result.current[0]).toBe(true);
    act(() => { vi.advanceTimersByTime(200); });
    expect(result.current[0]).toBe(false);
  });

  it('can be cleared early', () => {
    const { result } = renderHook(() => useTransientFlag(1000));
    act(() => result.current[1]());
    act(() => result.current[2]());
    expect(result.current[0]).toBe(false);
  });
});
