import { useEffect, useSyncExternalStore } from 'react';
import { apiFetch } from '@/shared/api/api';

// Every server emoji the account may use, from all of its servers: what the
// picker and the composer's suggestions offer, and what a typed ":name:" is
// sent as. One request for all servers (GET /api/me/emojis), refetched when a
// server's list changes or the account joins or leaves a server.

export interface CustomEmoji {
  id: string;
  name: string;
  animated: boolean;
  serverId: string;
}

export interface ServerEmojiGroup {
  serverId: string;
  emojis: CustomEmoji[];
}

interface MyEmojisState {
  accountId: string | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  servers: ServerEmojiGroup[];
  byId: Map<string, CustomEmoji>;
}

const EMPTY: MyEmojisState = { accountId: null, status: 'idle', servers: [], byId: new Map() };
let state = EMPTY;
let stale = false;
const listeners = new Set<() => void>();

function set(next: MyEmojisState): void {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function load(accountId: string): void {
  stale = false;
  if (state.accountId !== accountId) set({ ...EMPTY, accountId, status: 'loading' });
  else if (state.status !== 'ready') set({ ...state, status: 'loading' });
  apiFetch<{ servers: { serverId: string; emojis: Omit<CustomEmoji, 'serverId'>[] }[] }>('/api/me/emojis')
    .then((res) => {
      if (state.accountId !== accountId) return;
      const servers = res.servers.map(({ serverId, emojis }) => ({ serverId, emojis: emojis.map((e) => ({ ...e, serverId })) }));
      const byId = new Map(servers.flatMap((group) => group.emojis.map((e) => [e.id, e] as const)));
      set({ accountId, status: 'ready', servers, byId });
      if (stale) load(accountId);
    })
    .catch(() => { if (state.accountId === accountId && state.status !== 'ready') set({ ...state, status: 'error' }); });
}

let inFlight = false;

/** A server's emojis or the account's servers changed: refetch if loaded. */
export function invalidateMyEmojis(): void {
  if (!state.accountId || state.status === 'idle') return;
  if (state.status === 'loading' || inFlight) { stale = true; return; }
  inFlight = true;
  const accountId = state.accountId;
  // a burst of changes (a member uploading several) asks once
  queueMicrotask(() => { inFlight = false; load(accountId); });
}

export function useMyEmojis(accountId: string | null, enabled = true): MyEmojisState {
  const snapshot = useSyncExternalStore(subscribe, () => state);
  useEffect(() => {
    if (!enabled || !accountId) return;
    if (state.accountId !== accountId || state.status === 'idle' || state.status === 'error') load(accountId);
  }, [enabled, accountId]);
  return snapshot.accountId === accountId ? snapshot : EMPTY;
}

/** One of the account's server emojis, if it is (and the list is loaded). */
export function useKnownCustomEmoji(emojiId: string): CustomEmoji | undefined {
  return useSyncExternalStore(subscribe, () => state.byId.get(emojiId));
}

/** For tests. */
export function setMyEmojisForTests(accountId: string, servers: ServerEmojiGroup[]): void {
  set({ accountId, status: 'ready', servers, byId: new Map(servers.flatMap((g) => g.emojis.map((e) => [e.id, e] as const))) });
}

export function resetMyEmojis(): void {
  set(EMPTY);
}
