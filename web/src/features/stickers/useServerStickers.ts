import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { fetchServerStickers, type ServerSticker } from './stickersApi';
import { invalidateMyStickers } from './myStickers';

interface ServerStickersState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  stickers: ServerSticker[];
  limit: number;
}

const IDLE: ServerStickersState = { status: 'idle', stickers: [], limit: 0 };

// A server's stickers as its settings page lists them (with who sent each).
// What members SEND comes from myStickers.ts, one request for all their servers.
const cache = new Map<string, ServerStickersState>();
const listeners = new Set<() => void>();
const inFlight = new Map<string, Promise<void>>();

function set(serverId: string, next: ServerStickersState): void {
  cache.set(serverId, next);
  for (const listener of listeners) listener();
}

function load(serverId: string): Promise<void> {
  const pending = inFlight.get(serverId);
  if (pending) return pending;
  const prev = cache.get(serverId) ?? IDLE;
  if (prev.status !== 'ready') set(serverId, { ...prev, status: 'loading' });
  const request = fetchServerStickers(serverId)
    .then(({ stickers, limit }) => set(serverId, { status: 'ready', stickers, limit }))
    .catch(() => { if (prev.status !== 'ready') set(serverId, { ...prev, status: 'error' }); })
    .finally(() => inFlight.delete(serverId));
  inFlight.set(serverId, request);
  return request;
}

/** On `server-stickers-changed` or after an upload here: refetches what someone has loaded. */
export function invalidateServerStickers(serverId: string): void {
  if (cache.has(serverId)) void load(serverId);
  invalidateMyStickers();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useServerStickers(serverId: string | null) {
  const state = useSyncExternalStore(subscribe, () => (serverId ? cache.get(serverId) ?? IDLE : IDLE));
  useEffect(() => {
    if (serverId && (cache.get(serverId)?.status ?? 'error') === 'error') void load(serverId);
  }, [serverId]);
  const reload = useCallback(() => (serverId ? load(serverId) : Promise.resolve()), [serverId]);
  return { ...state, reload };
}
