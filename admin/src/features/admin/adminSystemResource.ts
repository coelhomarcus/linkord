import { useEffect, useSyncExternalStore } from 'react';
import { fetchSystem, type SystemInfo } from './adminApi';
import type { AdminDetailStatus } from './useAdminDetail';

interface SystemRead {
  data: { info: SystemInfo; at: number } | null;
  pending: boolean;
  failure: 'missing' | 'error' | null;
}

const initial: SystemRead = { data: null, pending: false, failure: null };
const listeners = new Set<() => void>();
let snapshot = initial;
let request: AbortController | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function publish(next: SystemRead) {
  snapshot = next;
  for (const listener of listeners) listener();
}

async function readSystem() {
  if (request) return;
  const controller = new AbortController();
  request = controller;
  publish({ ...snapshot, pending: true, failure: null });
  try {
    const info = await fetchSystem(controller.signal);
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

function refreshSystem() {
  request?.abort();
  request = null;
  return readSystem();
}

/** The dashboard and system page share the latest read while a new one loads. */
export function useAdminSystem() {
  const { data, pending, failure } = useSyncExternalStore(subscribe, () => snapshot);
  useEffect(() => { void readSystem(); }, []);
  const status: AdminDetailStatus = data ? 'ready' : failure ?? 'loading';
  return { data, status, refresh: refreshSystem, refreshing: pending, refreshFailed: data !== null && failure !== null };
}

export function clearAdminSystem() {
  request?.abort();
  request = null;
  publish(initial);
}
