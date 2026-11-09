import { useEffect, useSyncExternalStore } from 'react';
import { fetchMySounds } from './soundboardApi';
import type { SoundboardServer } from './soundboardApi';

// The sounds a call's picker offers: every server whose soundboard the
// account may use, in one request (GET /api/me/sounds). Refetched when a
// server's sounds change or the account joins or leaves a server.

interface MySoundsState {
  accountId: string | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  maxSounds: number;
  servers: SoundboardServer[];
}

const EMPTY: MySoundsState = { accountId: null, status: 'idle', maxSounds: 0, servers: [] };
let state = EMPTY;
let stale = false;
let queued = false;
const listeners = new Set<() => void>();

function set(next: MySoundsState): void {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function load(accountId: string): void {
  stale = false;
  set(state.accountId === accountId && state.status === 'ready' ? state : { ...EMPTY, accountId, status: 'loading' });
  fetchMySounds()
    .then(({ maxSounds, servers }) => {
      if (state.accountId !== accountId) return;
      set({ accountId, status: 'ready', maxSounds, servers });
      if (stale) load(accountId);
    })
    .catch(() => { if (state.accountId === accountId && state.status !== 'ready') set({ ...state, status: 'error' }); });
}

/** A server's sounds or the account's servers changed: refetch if loaded. */
export function invalidateMySounds(): void {
  if (!state.accountId || state.status === 'idle' || state.status === 'error') return;
  if (state.status === 'loading' || queued) { stale = true; return; }
  queued = true;
  const accountId = state.accountId;
  queueMicrotask(() => { queued = false; load(accountId); });
}

export function useMySounds(accountId: string | null, enabled = true): MySoundsState & { reload: () => void } {
  const snapshot = useSyncExternalStore(subscribe, () => state);
  useEffect(() => {
    if (!enabled || !accountId) return;
    if (state.accountId !== accountId || state.status === 'idle' || state.status === 'error') load(accountId);
  }, [enabled, accountId]);
  const reload = () => { if (accountId) load(accountId); };
  return { ...(snapshot.accountId === accountId ? snapshot : EMPTY), reload };
}

/** For tests. */
export function resetMySounds(): void {
  set(EMPTY);
}
