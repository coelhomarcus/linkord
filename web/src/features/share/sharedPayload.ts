// What the service worker stored for one share (public/sw.js, receiveShare).
// The names below must match the worker's: it is plain JS and cannot import them.

export const SHARE_CACHE = 'linkord-share-v1';
const SHARE_PATH = '/share-target';
export const SHARE_TTL_MS = 60 * 60 * 1000;

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface StoredMeta {
  createdAt: number;
  title: string;
  text: string;
  url: string;
  files: Array<{ name: string; type: string; lastModified: number }>;
}

export interface SharedPayload {
  id: string;
  files: File[];
  /** The title, text and link the sender app gave, as lines the way they read in a message. */
  text: string;
}

const entryUrl = (id: string, part: string) => new URL(`${SHARE_PATH}/${id}/${part}`, window.location.origin).href;

export function isShareId(value: string | null): value is string {
  return !!value && ID_PATTERN.test(value);
}

/** Many apps put the link inside `text` already, and some repeat the title there. */
export function composeSharedText(meta: Pick<StoredMeta, 'title' | 'text' | 'url'>): string {
  const lines: string[] = [];
  for (const part of [meta.title, meta.text, meta.url].map((value) => value.trim())) {
    if (part && !lines.some((line) => line.includes(part))) lines.push(part);
  }
  return lines.join('\n');
}

export async function readSharedPayload(id: string): Promise<SharedPayload | null> {
  if (!isShareId(id) || typeof caches === 'undefined') return null;
  try {
    const cache = await caches.open(SHARE_CACHE);
    const metaResponse = await cache.match(entryUrl(id, 'meta'));
    if (!metaResponse) return null;
    const meta = (await metaResponse.json()) as StoredMeta;
    if (Date.now() - meta.createdAt >= SHARE_TTL_MS) return null;
    const files: File[] = [];
    for (const [index, info] of meta.files.entries()) {
      const stored = await cache.match(entryUrl(id, `file/${index}`));
      if (!stored) return null;
      files.push(new File([await stored.blob()], info.name, { type: info.type, lastModified: info.lastModified }));
    }
    return { id, files, text: composeSharedText(meta) };
  } catch {
    return null;
  }
}

/** Once the files are in a draft (or the share was dismissed) the copies in the cache are dead weight. */
export async function discardSharedPayload(id: string): Promise<void> {
  if (!isShareId(id) || typeof caches === 'undefined') return;
  try {
    const cache = await caches.open(SHARE_CACHE);
    for (const request of await cache.keys()) {
      if (new URL(request.url).pathname.startsWith(`${SHARE_PATH}/${id}/`)) await cache.delete(request);
    }
  } catch {
    // the worker's own sweep removes it after SHARE_TTL_MS
  }
}

/** Shares nobody chose a place for (the tab was closed on the picker) go once they are old enough. */
export async function sweepExpiredShares(): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    const cache = await caches.open(SHARE_CACHE);
    const requests = await cache.keys();
    for (const request of requests) {
      const match = /^\/share-target\/([0-9a-f-]{36})\/meta$/.exec(new URL(request.url).pathname);
      if (!match) continue;
      const meta = (await (await cache.match(request))?.json().catch(() => null)) as Partial<StoredMeta> | null;
      if (typeof meta?.createdAt === 'number' && Date.now() - meta.createdAt < SHARE_TTL_MS) continue;
      await discardSharedPayload(match[1]!);
    }
  } catch {
    // the worker sweeps too
  }
}
