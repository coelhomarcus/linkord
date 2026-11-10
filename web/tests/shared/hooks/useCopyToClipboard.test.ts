import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COPIED_FOR_MS, useCopyToClipboard } from '@/shared/hooks/useCopyToClipboard';
import { liveAnnouncements } from '@tests/fixtures/announcerFixture';

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
}

describe('useCopyToClipboard', () => {
  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  it('confirms a copy for 1.5 s and announces it', async () => {
    vi.useFakeTimers();
    stubClipboard(vi.fn().mockResolvedValue(undefined));
    const { result } = renderHook(() => useCopyToClipboard());

    await act(async () => { await result.current.copy('abc'); });
    expect(result.current.copied).toBe(true);
    expect(liveAnnouncements()).toEqual(['Copiado']);

    expect(COPIED_FOR_MS).toBe(1500);
    act(() => { vi.advanceTimersByTime(COPIED_FOR_MS - 1); });
    expect(result.current.copied).toBe(true);
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current.copied).toBe(false);
  });

  it('shows no check mark when the browser refuses', async () => {
    stubClipboard(vi.fn().mockRejectedValue(new Error('denied')));
    const { result } = renderHook(() => useCopyToClipboard());
    await act(async () => { expect(await result.current.copy('abc')).toBe(false); });
    expect(result.current.copied).toBe(false);
    expect(liveAnnouncements()).toEqual([]);
  });

  it('reset drops the check mark at once', async () => {
    stubClipboard(vi.fn().mockResolvedValue(undefined));
    const { result } = renderHook(() => useCopyToClipboard());
    await act(async () => { await result.current.copy('abc'); });
    act(() => result.current.reset());
    expect(result.current.copied).toBe(false);
  });
});
