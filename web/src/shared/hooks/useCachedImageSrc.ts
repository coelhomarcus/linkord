import { useEffect, useState } from 'react';

// The server rechecks membership on every attachment request. This tab reuses a blob only after
// that check succeeds, avoiding repeat fetches on conversation switches without extending access
// after reload or allowing a removed member to fetch new files.
interface Entry { objectUrl: string; refCount: number; bytes: number }
const cache = new Map<string, Entry>(); // insertion order doubles as LRU order for refCount === 0 entries
const MAX_IDLE_ENTRIES = 200;
// Counting entries alone let a few hundred full-size pictures pin hundreds
// of MB after scrolling through a media-heavy chat; idle ones also answer to
// a byte budget. Whatever is on screen is never dropped.
const MAX_IDLE_BYTES = 64 * 1024 * 1024;

function touch(url: string, entry: Entry) {
  cache.delete(url);
  cache.set(url, entry); // re-insert at the end = most recently used
}

function evictIdleEntries() {
  let idleBytes = 0;
  for (const entry of cache.values()) if (entry.refCount <= 0) idleBytes += entry.bytes;
  if (cache.size <= MAX_IDLE_ENTRIES && idleBytes <= MAX_IDLE_BYTES) return;
  for (const [url, entry] of cache) {
    if (cache.size <= MAX_IDLE_ENTRIES && idleBytes <= MAX_IDLE_BYTES) break;
    if (entry.refCount > 0) continue; // never drop something currently on screen
    URL.revokeObjectURL(entry.objectUrl);
    cache.delete(url);
    idleBytes -= entry.bytes;
  }
}

/** Test-only: how many blobs are held right now. */
export function __cachedImageCountForTests(): number {
  return cache.size;
}

/** Test-only: without this, two tests mocking different bytes for the same
 * url leak into each other through the module-level cache. */
export function __resetCachedImageSrcForTests(): void {
  for (const entry of cache.values()) URL.revokeObjectURL(entry.objectUrl);
  cache.clear();
}

/** A `src` for an <img> that repaints instantly on every remount after the
 * first successful load, instead of re-triggering a network round trip —
 * see the module comment above for why chat attachments need this. `null`
 * while the first fetch for a given url is in flight — callers should leave
 * `src` unset rather than falling back to the raw url during that window:
 * that would fire a second, concurrent request for the same resource (a real
 * regression measured live — 20 /uploads/ requests for 8 attachments on a
 * cold load). The raw url is only ever used as a fallback AFTER our own
 * fetch has actually failed, never alongside it. */
export function useCachedImageSrc(url: string | null | undefined): string | null {
  const [src, setSrc] = useState<string | null>(() => (url ? cache.get(url)?.objectUrl ?? null : null));

  useEffect(() => {
    if (!url) { setSrc(null); return; }

    const existing = cache.get(url);
    if (existing) {
      existing.refCount++;
      touch(url, existing);
      setSrc(existing.objectUrl);
      return () => { existing.refCount--; evictIdleEntries(); };
    }

    let cancelled = false;
    const controller = new AbortController();
    setSrc(null);
    fetch(url, { credentials: 'same-origin', signal: controller.signal })
      .then((res) => (res.ok ? res.blob() : Promise.reject(new Error(String(res.status)))))
      .then((blob) => {
        if (cancelled) return;
        const objectUrl = URL.createObjectURL(blob);
        cache.set(url, { objectUrl, refCount: 1, bytes: blob.size });
        evictIdleEntries();
        setSrc(objectUrl);
      })
      .catch(() => { if (!cancelled) setSrc(url); }); // last resort: a normal <img> load, only after ours failed

    return () => {
      cancelled = true;
      controller.abort();
      const entry = cache.get(url);
      if (entry) { entry.refCount--; evictIdleEntries(); }
    };
  }, [url]);

  return src;
}
