import { useEffect, useSyncExternalStore } from 'react';
import { fetchCallMetrics, fetchSystem } from './adminApi';
import type { AdminDetailStatus } from './useAdminDetail';

interface AdminRead<T> {
  data: { info: T; at: number } | null;
  pending: boolean;
  failure: 'missing' | 'error' | null;
}

function createAdminRead<T>(fetcher: (signal: AbortSignal) => Promise<T>) {
  const initial: AdminRead<T> = { data: null, pending: false, failure: null };
  const listeners = new Set<() => void>();
  let snapshot = initial;
  let request: AbortController | null = null;

  function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }

  function publish(next: AdminRead<T>) {
    snapshot = next;
    for (const listener of listeners) listener();
  }

  async function read() {
    if (request) return;
    const controller = new AbortController();
    request = controller;
    publish({ ...snapshot, pending: true });
    try {
      const info = await fetcher(controller.signal);
      if (request === controller) publish({ data: { info, at: Date.now() }, pending: false, failure: null });
    } catch (error) {
      if (request !== controller) return;
      const status = (error as { status?: number } | null)?.status;
      const data = status === 401 || status === 403 || status === 404 ? null : snapshot.data;
      publish({ data, pending: false, failure: status === 404 ? 'missing' : 'error' });
    } finally {
      if (request === controller) request = null;
    }
  }

  function cancel() {
    request?.abort();
    request = null;
  }

  return {
    subscribe,
    snapshot: () => snapshot,
    read,
    refresh: () => { cancel(); return read(); },
    clear: () => { cancel(); publish(initial); },
  };
}

function useAdminRead<T>(resource: ReturnType<typeof createAdminRead<T>>, intervalMs?: number) {
  const { data, pending, failure } = useSyncExternalStore(resource.subscribe, resource.snapshot);
  useEffect(() => {
    void resource.read();
    if (!intervalMs) return;
    const timer = window.setInterval(() => void resource.read(), intervalMs);
    return () => window.clearInterval(timer);
  }, [resource, intervalMs]);
  const status: AdminDetailStatus = data ? 'ready' : failure ?? 'loading';
  return { data, status, refresh: resource.refresh, refreshing: pending, refreshFailed: data !== null && failure !== null };
}

const system = createAdminRead(fetchSystem);
const callMetrics = createAdminRead(fetchCallMetrics);

export function useAdminSystem() {
  return useAdminRead(system);
}

export function useAdminCallMetrics() {
  return useAdminRead(callMetrics, 15_000);
}

export function clearAdminResources() {
  system.clear();
  callMetrics.clear();
}
