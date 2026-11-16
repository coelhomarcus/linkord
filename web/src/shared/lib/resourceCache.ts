import { useEffect, useSyncExternalStore } from 'react';

/** What a cache knows about one key. Immutable: a change replaces the object,
 * so `useSyncExternalStore` sees it. */
interface ResourceEntry<V> {
  /** the last answer, kept while a newer one is fetched (stale-while-revalidate) */
  value: V | undefined;
  hasValue: boolean;
  /** the last request failed and there is no value to show instead */
  failed: boolean;
  fetching: boolean;
  /** the token (a revision) the value was read at; see `load` */
  token: unknown;
  /** written by this tab (an optimistic change) rather than read from the server */
  local: boolean;
}

export interface ResourceCache<V> {
  peek(key: string): ResourceEntry<V> | undefined;
  /** Reads `key` from the server. A request already in flight for the same
   * token is shared; one for an older token is superseded, its answer dropped. */
  load(key: string, token?: unknown): Promise<V>;
  /** An optimistic or confirmed value written by this tab. Answers to requests
   * that started before it are dropped, so they cannot undo it. */
  set(key: string, value: V, options?: { local?: boolean }): void;
  /** A first guess for a key with no value yet (a partial record from a list).
   * Unlike `set` it never cancels a read in flight, whose answer replaces it. */
  seed(key: string, value: V): void;
  delete(key: string): void;
  clear(): void;
  subscribe(listener: () => void): () => void;
}

/** A failed read that means "this is gone or no longer yours to see": the
 * value is dropped rather than kept as stale. */
function isGone(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return status === 403 || status === 404;
}

const registry = new Set<{ clear(): void }>();

/** Forgets every cached resource: another account signing in must never see
 * the previous one's relationships or profiles, and tests must not leak. */
export function clearResourceCaches(): void {
  for (const cache of registry) cache.clear();
}

/** State kept beside a cache (a queue of changes) that must go with it. */
export function onResourceCachesCleared(clear: () => void): void {
  registry.add({ clear });
}

/** A bounded, module-level cache of server reads, shared by every component
 * that shows the same resource. Insertion order doubles as LRU order. */
export function createResourceCache<V>(fetcher: (key: string, signal: AbortSignal) => Promise<V>, { max = 200 } = {}): ResourceCache<V> {
  const entries = new Map<string, ResourceEntry<V>>();
  const inFlight = new Map<string, { token: unknown; promise: Promise<V>; abort: AbortController }>();
  // bumped by every write, so an answer to an older request is recognised and dropped
  const versions = new Map<string, number>();
  const listeners = new Set<() => void>();

  const emit = () => { for (const listener of listeners) listener(); };
  const versionOf = (key: string) => versions.get(key) ?? 0;
  const bump = (key: string) => versions.set(key, versionOf(key) + 1);

  function write(key: string, patch: Partial<ResourceEntry<V>>) {
    const previous = entries.get(key) ?? { value: undefined, hasValue: false, failed: false, fetching: false, token: undefined, local: false };
    entries.delete(key);
    entries.set(key, { ...previous, ...patch });
    while (entries.size > max) {
      const oldest = entries.keys().next().value!;
      entries.delete(oldest);
      versions.delete(oldest);
    }
    emit();
  }

  const cache: ResourceCache<V> = {
    peek: (key) => entries.get(key),
    load(key, token) {
      const running = inFlight.get(key);
      if (running && running.token === token) return running.promise;
      running?.abort.abort();
      bump(key);
      const version = versionOf(key);
      const abort = new AbortController();
      const promise = fetcher(key, abort.signal).then(
        (value) => {
          if (versionOf(key) === version) {
            inFlight.delete(key);
            write(key, { value, hasValue: true, failed: false, fetching: false, token, local: false });
          }
          return value;
        },
        (error: unknown) => {
          if (versionOf(key) === version) {
            inFlight.delete(key);
            const entry = entries.get(key);
            if (isGone(error) || !entry?.hasValue) write(key, { value: undefined, hasValue: false, failed: true, fetching: false });
            else write(key, { fetching: false });
          }
          throw error;
        },
      );
      inFlight.set(key, { token, promise, abort });
      write(key, { fetching: true });
      return promise;
    },
    set(key, value, { local = true } = {}) {
      const running = inFlight.get(key);
      if (running) { running.abort.abort(); inFlight.delete(key); }
      bump(key);
      write(key, { value, hasValue: true, failed: false, fetching: false, local });
    },
    seed(key, value) {
      if (entries.get(key)?.hasValue) return;
      write(key, { value, hasValue: true, failed: false, local: true });
    },
    delete(key) {
      inFlight.get(key)?.abort.abort();
      inFlight.delete(key);
      bump(key);
      if (entries.delete(key)) emit();
    },
    clear() {
      for (const running of inFlight.values()) running.abort.abort();
      inFlight.clear();
      // versions are kept and bumped, so an answer still on its way is dropped too
      for (const key of versions.keys()) bump(key);
      entries.clear();
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
  registry.add(cache);
  return cache;
}

export interface ResourceState<V> {
  /** `ready` with any value, even a stale one being revalidated */
  status: 'loading' | 'ready' | 'error';
  value: V | undefined;
  entry: ResourceEntry<V> | undefined;
  retry: () => void;
}

/** Reads `key` from `cache` and keeps it fresh: what is cached renders at once,
 * and a read goes out when the component mounts, when `key` changes and when
 * `token` moves (a revision of whatever the resource depends on). `null` reads nothing. */
export function useResource<V>(cache: ResourceCache<V>, key: string | null, token?: unknown): ResourceState<V> {
  const entry = useSyncExternalStore(cache.subscribe, () => (key ? cache.peek(key) : undefined));

  // a request another component already has in flight at the same token is shared (see `load`)
  useEffect(() => {
    if (key) void cache.load(key, token).catch(() => {});
  }, [cache, key, token]);

  let status: ResourceState<V>['status'] = 'loading';
  if (entry?.hasValue) status = 'ready';
  else if (entry?.failed && !entry.fetching) status = 'error';
  return {
    status,
    value: entry?.hasValue ? entry.value : undefined,
    entry,
    retry: () => { if (key) void cache.load(key, Symbol('retry')).catch(() => {}); },
  };
}
