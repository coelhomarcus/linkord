import { useEffect, useSyncExternalStore } from 'react';
import { apiFetch } from '@/shared/api/api';

// What the account uses most, as counted by the server when a message, a
// reaction or a sound goes out (server/src/modules/emojis/expressionUsage.ts),
// so the composer, the reaction picker and the soundboard rank alike on every
// device. A use made here is counted locally at once too: the list must not
// wait for a refetch to move.

export type FrequentKind = 'emojis' | 'sounds';

interface FrequentEntry {
  key: string;
  count: number;
}

interface FrequentState {
  accountId: string | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  emojis: FrequentEntry[];
  sounds: FrequentEntry[];
}

let state: FrequentState = { accountId: null, status: 'idle', emojis: [], sounds: [] };
const listeners = new Set<() => void>();

function set(next: FrequentState): void {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function sorted(entries: FrequentEntry[]): FrequentEntry[] {
  // stable: among equal counts the most recently used (listed first) stays first
  return [...entries].sort((a, b) => b.count - a.count);
}

function load(accountId: string): void {
  if (state.accountId === accountId && (state.status === 'loading' || state.status === 'ready')) return;
  set({ accountId, status: 'loading', emojis: state.accountId === accountId ? state.emojis : [], sounds: state.accountId === accountId ? state.sounds : [] });
  apiFetch<{ emojis: FrequentEntry[]; sounds: FrequentEntry[] }>('/api/me/frequent-expressions')
    .then((res) => {
      if (state.accountId !== accountId) return;
      // uses counted here while the request was out are kept on top of it
      set({ accountId, status: 'ready', emojis: merge(res.emojis, state.emojis), sounds: merge(res.sounds, state.sounds) });
    })
    .catch(() => { if (state.accountId === accountId) set({ ...state, status: 'error' }); });
}

function merge(server: FrequentEntry[], local: FrequentEntry[]): FrequentEntry[] {
  const out = new Map(server.map((e) => [e.key, { ...e }]));
  for (const e of local) {
    const known = out.get(e.key);
    if (!known) out.set(e.key, { ...e });
  }
  return sorted([...out.values()]);
}

/** Counts a use right away, ahead of the server's own count. */
export function noteExpressionUse(kind: FrequentKind, keys: string[]): void {
  if (!keys.length) return;
  const entries = state[kind].map((e) => ({ ...e }));
  for (const key of new Set(keys)) {
    const index = entries.findIndex((e) => e.key === key);
    if (index === -1) entries.unshift({ key, count: 1 });
    else {
      const [hit] = entries.splice(index, 1);
      entries.unshift({ key, count: hit!.count + 1 });
    }
  }
  set({ ...state, [kind]: sorted(entries) });
}

/** The account's most used keys of `kind`, most used first. Fetched the
 * first time a caller with `enabled` mounts for this account. */
export function useFrequentExpressions(accountId: string | null, kind: FrequentKind, enabled = true): string[] {
  const snapshot = useSyncExternalStore(subscribe, () => state);
  useEffect(() => {
    if (enabled && accountId) load(accountId);
  }, [enabled, accountId]);
  if (!accountId || snapshot.accountId !== accountId) return EMPTY;
  return keysOf(snapshot, kind);
}

const EMPTY: string[] = [];
const keyCache = new WeakMap<FrequentEntry[], string[]>();

function keysOf(snapshot: FrequentState, kind: FrequentKind): string[] {
  const entries = snapshot[kind];
  let keys = keyCache.get(entries);
  if (!keys) { keys = entries.map((e) => e.key); keyCache.set(entries, keys); }
  return keys;
}

/** For tests. */
export function resetFrequentExpressions(): void {
  set({ accountId: null, status: 'idle', emojis: [], sounds: [] });
}
