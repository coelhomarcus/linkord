import { useEffect, useSyncExternalStore } from 'react';
import { apiFetch } from '@/shared/api/api';

// Every sticker the account may send, from all of its servers: what the
// picker offers. One request for all servers (GET /api/me/stickers),
// refetched when a server's list changes or the account joins or leaves one.

export interface MySticker {
  id: string;
  name: string;
  description: string;
  emoji: string;
  animated: boolean;
  serverId: string;
}

export interface ServerStickerGroup {
  serverId: string;
  stickers: MySticker[];
}

interface MyStickersState {
  accountId: string | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  servers: ServerStickerGroup[];
  byId: Map<string, MySticker>;
}

const EMPTY: MyStickersState = { accountId: null, status: 'idle', servers: [], byId: new Map() };
let state = EMPTY;
let stale = false;
let inFlight = false;
const listeners = new Set<() => void>();

function set(next: MyStickersState): void {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function indexed(accountId: string, servers: ServerStickerGroup[]): MyStickersState {
  return { accountId, status: 'ready', servers, byId: new Map(servers.flatMap((g) => g.stickers.map((s) => [s.id, s] as const))) };
}

function load(accountId: string): void {
  stale = false;
  if (state.accountId !== accountId) set({ ...EMPTY, accountId, status: 'loading' });
  else if (state.status !== 'ready') set({ ...state, status: 'loading' });
  apiFetch<{ servers: { serverId: string; stickers: Omit<MySticker, 'serverId'>[] }[] }>('/api/me/stickers')
    .then((res) => {
      if (state.accountId !== accountId) return;
      set(indexed(accountId, res.servers.map(({ serverId, stickers }) => ({ serverId, stickers: stickers.map((s) => ({ ...s, serverId })) }))));
      if (stale) load(accountId);
    })
    .catch(() => { if (state.accountId === accountId && state.status !== 'ready') set({ ...state, status: 'error' }); });
}

/** A server's stickers or the account's servers changed: refetch if loaded. */
export function invalidateMyStickers(): void {
  if (!state.accountId || state.status === 'idle') return;
  if (state.status === 'loading' || inFlight) { stale = true; return; }
  inFlight = true;
  const accountId = state.accountId;
  // a burst of changes (a member uploading several) asks once
  queueMicrotask(() => { inFlight = false; load(accountId); });
}

export function useMyStickers(accountId: string | null, enabled = true): MyStickersState {
  const snapshot = useSyncExternalStore(subscribe, () => state);
  useEffect(() => {
    if (!enabled || !accountId) return;
    if (state.accountId !== accountId || state.status === 'idle' || state.status === 'error') load(accountId);
  }, [enabled, accountId]);
  return snapshot.accountId === accountId ? snapshot : EMPTY;
}

/** One of the account's stickers, if it is (and the list is loaded). */
export function useKnownSticker(stickerId: string): MySticker | undefined {
  return useSyncExternalStore(subscribe, () => state.byId.get(stickerId));
}

/** For tests. */
export function setMyStickersForTests(accountId: string, servers: ServerStickerGroup[]): void {
  set(indexed(accountId, servers));
}

export function resetMyStickers(): void {
  set(EMPTY);
}
