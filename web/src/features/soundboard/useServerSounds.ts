import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { fetchServerSounds } from './soundboardApi';
import type { ServerSound } from './soundboardApi';

export interface ServerSoundsState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  sounds: ServerSound[];
  maxSounds: number;
}

const IDLE: ServerSoundsState = { status: 'idle', sounds: [], maxSounds: 0 };

// One cache shared by the group panel and the call's picker, so both show the
// same list and a `group-sounds-changed` refetches it once for both.
const cache = new Map<string, ServerSoundsState>();
const listeners = new Set<() => void>();
const inFlight = new Map<string, Promise<void>>();

function set(serverId: string, next: ServerSoundsState): void {
  cache.set(serverId, next);
  for (const listener of listeners) listener();
}

function load(serverId: string): Promise<void> {
  const pending = inFlight.get(serverId);
  if (pending) return pending;
  const prev = cache.get(serverId) ?? IDLE;
  // a refetch keeps showing the list it already has instead of flashing to loading
  if (prev.status !== 'ready') set(serverId, { ...prev, status: 'loading' });
  const request = fetchServerSounds(serverId)
    .then(({ sounds, maxSounds }) => set(serverId, { status: 'ready', sounds, maxSounds }))
    .catch(() => { if (prev.status !== 'ready') set(serverId, { ...prev, status: 'error' }); })
    .finally(() => inFlight.delete(serverId));
  inFlight.set(serverId, request);
  return request;
}

/** Called on `group-sounds-changed`: refetches only lists someone has loaded. */
export function invalidateServerSounds(serverId: string): void {
  if (cache.has(serverId)) void load(serverId);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useServerSounds(serverId: string | null) {
  const state = useSyncExternalStore(subscribe, () => (serverId ? cache.get(serverId) ?? IDLE : IDLE));

  useEffect(() => {
    if (serverId && (cache.get(serverId)?.status ?? 'error') === 'error') void load(serverId);
  }, [serverId]);

  const reload = useCallback(() => (serverId ? load(serverId) : Promise.resolve()), [serverId]);

  return { ...state, reload };
}
