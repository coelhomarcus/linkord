import { useSyncExternalStore } from 'react';
import { LOCAL_STORAGE_KEYS, localStorageStore } from '@/shared/lib/localStorage';
import { onResourceCachesCleared } from '@/shared/lib/resourceCache';
import { parseStoredQuery, queryKey, type SearchQuery } from './searchQuery';

// The recent searches of each server, or each DM, newest first. Kept in this
// browser only, read through a store so the popover follows another tab's search.

const KEPT = 10;
const PREFIX = 'ss-search-history:';
const EMPTY: SearchQuery[] = [];
const cache = new Map<string, SearchQuery[]>();
const listeners = new Set<() => void>();

function read(contextId: string): SearchQuery[] {
  const cached = cache.get(contextId);
  if (cached) return cached;
  let entries = EMPTY;
  try {
    const parsed: unknown = JSON.parse(localStorageStore.get(LOCAL_STORAGE_KEYS.searchHistory(contextId)) ?? '[]');
    if (Array.isArray(parsed)) entries = parsed.map(parseStoredQuery).filter((q): q is SearchQuery => q !== null).slice(0, KEPT);
  } catch {
    // a damaged entry is an empty history, not a broken field
  }
  cache.set(contextId, entries);
  return entries;
}

function write(contextId: string, entries: SearchQuery[]): void {
  cache.set(contextId, entries);
  if (entries.length) localStorageStore.set(LOCAL_STORAGE_KEYS.searchHistory(contextId), JSON.stringify(entries));
  else localStorageStore.remove(LOCAL_STORAGE_KEYS.searchHistory(contextId));
  for (const listener of listeners) listener();
}

/** Puts a search at the top, dropping an older copy of it. */
export function rememberSearch(contextId: string, query: SearchQuery): void {
  const key = queryKey(query);
  write(contextId, [query, ...read(contextId).filter((q) => queryKey(q) !== key)].slice(0, KEPT));
}

export function clearSearchHistory(contextId: string): void {
  write(contextId, []);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key?.startsWith(PREFIX)) {
      cache.delete(event.key.slice(PREFIX.length));
      listener();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function useSearchHistory(contextId: string): SearchQuery[] {
  return useSyncExternalStore(subscribe, () => read(contextId), () => EMPTY);
}

// what one account searched is not left for the next to see
onResourceCachesCleared(() => {
  cache.clear();
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(PREFIX)) keys.push(key);
    }
    for (const key of keys) window.localStorage.removeItem(key);
  } catch {
    // storage blocked: nothing was kept either
  }
  for (const listener of listeners) listener();
});
