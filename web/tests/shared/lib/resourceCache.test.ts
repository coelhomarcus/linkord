import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { ApiError } from '@/shared/api/api';
import { clearResourceCaches, createResourceCache, useResource } from '@/shared/lib/resourceCache';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('createResourceCache', () => {
  it('shares a request in flight for the same key and token', async () => {
    const fetcher = vi.fn().mockResolvedValue('v1');
    const cache = createResourceCache<string>(fetcher);
    const [a, b] = [cache.load('k', 1), cache.load('k', 1)];
    expect(await a).toBe('v1');
    expect(await b).toBe('v1');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('asks again for a newer token and drops the older answer', async () => {
    const first = deferred<string>();
    const fetcher = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce('new');
    const cache = createResourceCache<string>(fetcher);
    void cache.load('k', 1);
    await cache.load('k', 2);
    first.resolve('old');
    await Promise.resolve();
    expect(cache.peek('k')?.value).toBe('new');
  });

  it('keeps the last value when a read fails, and drops it when the resource is gone', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce('v1').mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new ApiError(404, 'not_found', 'x'));
    const cache = createResourceCache<string>(fetcher);
    await cache.load('k');
    await expect(cache.load('k', 'again')).rejects.toThrow('offline');
    expect(cache.peek('k')).toMatchObject({ value: 'v1', hasValue: true, fetching: false });
    await expect(cache.load('k', 'gone')).rejects.toThrow();
    expect(cache.peek('k')).toMatchObject({ hasValue: false, failed: true });
  });

  it('never lets an answer from before a write undo it', async () => {
    const slow = deferred<string>();
    const cache = createResourceCache<string>(() => slow.promise);
    void cache.load('k').catch(() => {});
    cache.set('k', 'optimistic');
    slow.resolve('server, from before');
    await Promise.resolve();
    expect(cache.peek('k')?.value).toBe('optimistic');
  });

  it('a seed is replaced by the read in flight, and never replaces a value', async () => {
    const read = deferred<string>();
    const cache = createResourceCache<string>(() => read.promise);
    const loading = cache.load('k');
    cache.seed('k', 'partial');
    expect(cache.peek('k')?.value).toBe('partial');
    read.resolve('full');
    await loading;
    expect(cache.peek('k')?.value).toBe('full');
    cache.seed('k', 'partial again');
    expect(cache.peek('k')?.value).toBe('full');
  });

  it('forgets everything on clear, including answers still on their way', async () => {
    const read = deferred<string>();
    const cache = createResourceCache<string>(() => read.promise);
    void cache.load('k').catch(() => {});
    clearResourceCaches();
    read.resolve('from the previous account');
    await Promise.resolve();
    expect(cache.peek('k')).toBeUndefined();
  });
});

describe('useResource', () => {
  it('renders a cached value at once and reads it again behind it', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce('v1').mockResolvedValueOnce('v2');
    const cache = createResourceCache<string>(fetcher);
    await cache.load('k');

    const { result } = renderHook(() => useResource(cache, 'k'));
    expect(result.current).toMatchObject({ status: 'ready', value: 'v1' });
    await waitFor(() => expect(result.current.value).toBe('v2'));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('reads again when the token moves, and reports an error only without a value', async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce('v1');
    const cache = createResourceCache<string>(fetcher);
    const { result, rerender } = renderHook(({ token }) => useResource(cache, 'k', token), { initialProps: { token: 1 } });
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('error'));
    rerender({ token: 2 });
    await waitFor(() => expect(result.current).toMatchObject({ status: 'ready', value: 'v1' }));
    act(() => cache.set('k', 'local'));
    expect(result.current.value).toBe('local');
  });
});
