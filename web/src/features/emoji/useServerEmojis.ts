import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { fetchServerEmojis } from './serverEmojisApi';
import type { EmojiLimits, ServerEmoji } from './serverEmojisApi';
import { invalidateMyEmojis } from './myEmojis';

interface ServerEmojisState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  emojis: ServerEmoji[];
  limits: EmojiLimits;
}

const IDLE: ServerEmojisState = { status: 'idle', emojis: [], limits: { static: 0, animated: 0 } };

// A server's emojis as its settings page lists them (with who sent each).
// What members USE comes from myEmojis.ts, one request for all their servers.
const cache = new Map<string, ServerEmojisState>();
const listeners = new Set<() => void>();
const inFlight = new Map<string, Promise<void>>();

function set(serverId: string, next: ServerEmojisState): void {
  cache.set(serverId, next);
  for (const listener of listeners) listener();
}

function load(serverId: string): Promise<void> {
  const pending = inFlight.get(serverId);
  if (pending) return pending;
  const prev = cache.get(serverId) ?? IDLE;
  if (prev.status !== 'ready') set(serverId, { ...prev, status: 'loading' });
  const request = fetchServerEmojis(serverId)
    .then(({ emojis, limits }) => set(serverId, { status: 'ready', emojis, limits }))
    .catch(() => { if (prev.status !== 'ready') set(serverId, { ...prev, status: 'error' }); })
    .finally(() => inFlight.delete(serverId));
  inFlight.set(serverId, request);
  return request;
}

/** On `server-emojis-changed`: refetches what someone has loaded. */
export function invalidateServerEmojis(serverId: string): void {
  if (cache.has(serverId)) void load(serverId);
  invalidateMyEmojis();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useServerEmojis(serverId: string | null) {
  const state = useSyncExternalStore(subscribe, () => (serverId ? cache.get(serverId) ?? IDLE : IDLE));
  useEffect(() => {
    if (serverId && (cache.get(serverId)?.status ?? 'error') === 'error') void load(serverId);
  }, [serverId]);
  const reload = useCallback(() => (serverId ? load(serverId) : Promise.resolve()), [serverId]);
  return { ...state, reload };
}
