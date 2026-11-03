import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { fetchGroupSounds } from './soundboardApi';
import type { GroupSound } from './soundboardApi';

export interface GroupSoundsState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  sounds: GroupSound[];
  maxSounds: number;
}

const IDLE: GroupSoundsState = { status: 'idle', sounds: [], maxSounds: 0 };

// One cache shared by the group panel and the call's picker, so both show the
// same list and a `group-sounds-changed` refetches it once for both.
const cache = new Map<string, GroupSoundsState>();
const listeners = new Set<() => void>();
const inFlight = new Map<string, Promise<void>>();

function set(conversationId: string, next: GroupSoundsState): void {
  cache.set(conversationId, next);
  for (const listener of listeners) listener();
}

function load(conversationId: string): Promise<void> {
  const pending = inFlight.get(conversationId);
  if (pending) return pending;
  const prev = cache.get(conversationId) ?? IDLE;
  // a refetch keeps showing the list it already has instead of flashing to loading
  if (prev.status !== 'ready') set(conversationId, { ...prev, status: 'loading' });
  const request = fetchGroupSounds(conversationId)
    .then(({ sounds, maxSounds }) => set(conversationId, { status: 'ready', sounds, maxSounds }))
    .catch(() => { if (prev.status !== 'ready') set(conversationId, { ...prev, status: 'error' }); })
    .finally(() => inFlight.delete(conversationId));
  inFlight.set(conversationId, request);
  return request;
}

/** Called on `group-sounds-changed`: refetches only lists someone has loaded. */
export function invalidateGroupSounds(conversationId: string): void {
  if (cache.has(conversationId)) void load(conversationId);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useGroupSounds(conversationId: string | null) {
  const state = useSyncExternalStore(subscribe, () => (conversationId ? cache.get(conversationId) ?? IDLE : IDLE));

  useEffect(() => {
    if (conversationId && (cache.get(conversationId)?.status ?? 'error') === 'error') void load(conversationId);
  }, [conversationId]);

  const reload = useCallback(() => (conversationId ? load(conversationId) : Promise.resolve()), [conversationId]);

  return { ...state, reload };
}
