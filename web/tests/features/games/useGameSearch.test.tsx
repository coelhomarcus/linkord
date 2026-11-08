import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import * as api from '@/features/games/gamesApi';
import { clearGameSearchCache, normalizeGameQuery, SEARCH_DEBOUNCE_MS, useGameSearch } from '@/features/games/useGameSearch';
import { ApiError } from '@/shared/api/api';
import { game } from './fixtures';

vi.mock('@/features/games/gamesApi', () => ({ searchGames: vi.fn() }));
const search = vi.mocked(api.searchGames);
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS); });
const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' });

beforeEach(() => { vi.useFakeTimers(); clearGameSearchCache(); search.mockReset(); search.mockImplementation(async (query) => ({ games: [game(query.length)] })); });
afterEach(() => vi.useRealTimers());

describe('game search text', () => {
  it('ignores capitals and spacing', () => {
    expect(normalizeGameQuery('  The   LEGEND\tof Zelda ')).toBe('the legend of zelda');
  });
});

describe('useGameSearch', () => {
  it('asks once, after the typing stops, however fast the keys came', async () => {
    const { result, rerender } = renderHook(({ query }) => useGameSearch(query), { initialProps: { query: 'z' } });
    for (const query of ['ze', 'zel', 'zeld', 'zelda']) {
      rerender({ query });
      await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    }
    expect(result.current.status).toBe('loading');
    expect(search).not.toHaveBeenCalled();
    await settle();
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith('zelda', expect.any(AbortSignal));
    expect(result.current).toMatchObject({ status: 'ready', games: [game(5)] });
  });

  it('does not search for nothing or for a single character', async () => {
    const { result, rerender } = renderHook(({ query }) => useGameSearch(query), { initialProps: { query: '' } });
    await settle();
    for (const query of ['  ', 'a', ' a ']) { rerender({ query }); await settle(); expect(result.current.status).toBe('idle'); }
    expect(search).not.toHaveBeenCalled();
    rerender({ query: 'ab' }); await settle();
    expect(search).toHaveBeenCalledWith('ab', expect.any(AbortSignal));
  });

  it('does not search again when only capitals or spaces changed', async () => {
    const { result, rerender } = renderHook(({ query }) => useGameSearch(query), { initialProps: { query: 'zelda' } });
    await settle();
    for (const query of ['Zelda', 'zelda ', '  ZELDA  ', 'zelda']) { rerender({ query }); await settle(); }
    expect(search).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('ready');
  });

  it('answers a search made before from memory, at once', async () => {
    const { result, rerender } = renderHook(({ query }) => useGameSearch(query), { initialProps: { query: 'zelda' } });
    await settle();
    rerender({ query: 'mario' }); await settle();
    expect(search).toHaveBeenCalledTimes(2);
    rerender({ query: 'Zelda' });
    // no waiting for the debounce, no request
    expect(result.current).toMatchObject({ status: 'ready', games: [game(5)] });
    await settle();
    expect(search).toHaveBeenCalledTimes(2);
  });

  it('shares what it learned with the next editor opened', async () => {
    const first = renderHook(() => useGameSearch('zelda'));
    await settle(); first.unmount();
    const second = renderHook(() => useGameSearch('zelda'));
    expect(second.result.current.status).toBe('ready');
    await settle();
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('cancels the request when the text changes, and keeps only the newest answer', async () => {
    const signals: AbortSignal[] = [];
    const answers: ((value: { games: ReturnType<typeof game>[] }) => void)[] = [];
    search.mockImplementation((_query, signal) => { signals.push(signal!); return new Promise((resolve) => { answers.push(resolve); }); });
    const { result, rerender } = renderHook(({ query }) => useGameSearch(query), { initialProps: { query: 'zelda' } });
    await settle();
    rerender({ query: 'mario' }); await settle();
    expect(signals[0]!.aborted).toBe(true);
    expect(signals[1]!.aborted).toBe(false);
    // the answers arrive in the wrong order
    await act(async () => { answers[1]!({ games: [game(2)] }); });
    await act(async () => { answers[0]!({ games: [game(1)] }); });
    expect(result.current).toMatchObject({ status: 'ready', games: [game(2)] });
  });

  it('cancels the request when the picker goes away', async () => {
    let signal!: AbortSignal;
    search.mockImplementation((_query, s) => { signal = s!; return new Promise(() => undefined); });
    const { unmount } = renderHook(() => useGameSearch('zelda'));
    await settle();
    expect(signal.aborted).toBe(false);
    unmount();
    expect(signal.aborted).toBe(true);
  });

  it('does not report a cancelled request as an error', async () => {
    search.mockImplementationOnce((_query, signal) => new Promise((_resolve, reject) => { signal!.addEventListener('abort', () => reject(abortError())); }));
    const { result, rerender } = renderHook(({ query }) => useGameSearch(query), { initialProps: { query: 'zelda' } });
    await settle();
    rerender({ query: 'mario' });
    await settle();
    expect(result.current).toMatchObject({ status: 'ready', games: [game(5)] });
  });

  it.each([
    [503, 'unavailable'], [429, 'busy'], [502, 'failed'], [500, 'failed'],
  ])('tells a %i apart as "%s"', async (status, reason) => {
    search.mockRejectedValueOnce(new ApiError(status, 'x', 'x'));
    const { result } = renderHook(() => useGameSearch('zelda'));
    await settle();
    expect(result.current).toMatchObject({ status: 'error', reason });
  });

  it('treats a network failure as a failure to try again', async () => {
    search.mockRejectedValueOnce(new TypeError('offline'));
    const { result } = renderHook(() => useGameSearch('zelda'));
    await settle();
    expect(result.current).toMatchObject({ status: 'error', reason: 'failed' });
  });

  it('does not search on its own after a failure; retry asks once more, and a failure is not remembered', async () => {
    search.mockRejectedValueOnce(new ApiError(429, 'rate_limited', 'slow down'));
    const { result } = renderHook(() => useGameSearch('zelda'));
    await settle();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(search).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('error');
    act(() => result.current.retry());
    expect(result.current.status).toBe('loading');
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(search).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('ready');
  });
});
