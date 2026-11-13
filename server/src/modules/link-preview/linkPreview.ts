import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../../config/env.js';
import { sendJson, sendError } from '../../http/respond.js';
import { parseCookies } from '../../http/cookies.js';
import { resolveSession } from '../auth/session.js';
import { readImageDimensions, readImagePlaceholder } from '../attachments/attachmentThumbnails.js';
import { mediaProxy, PREVIEW_REDIRECTS } from '../media-proxy/mediaProxy.js';
import { allowedTarget, proxiedImageUrl } from '../media-proxy/mediaProxyUrls.js';
import type { Lookup } from './pageFetch.js';
import { emptyResult, hasContent, type LinkPreviewResult } from './preview.js';
import { canonicalUrl, runResolvers } from './resolvers.js';

// GET /api/link-preview?url=<url> — server-side fetch (avoids CORS) for a
// generic link's preview. The server fetches a URL chosen by whoever sends
// the chat message — classic SSRF risk; every outbound request goes through
// net/safeRequest.ts (see pageFetch.ts). How a URL becomes a preview is up
// to the resolvers (resolvers.ts): oEmbed for a few known providers, then
// the page's Open Graph tags.

// same link, same preview for everyone
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
// A failed or empty preview is kept only briefly: a site that was down for
// a minute must not stay a domain-only card for hours.
const EMPTY_CACHE_TTL_MS = 60 * 1000;
const CACHE_MAX_ENTRIES = 500;

interface CacheEntry {
  /** null: the fetch failed */
  value: LinkPreviewResult | null;
  expiresAtMs: number;
}

const cache = new Map<string, CacheEntry>(); // canonical url -> entry

function cacheGet(key: string): CacheEntry | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAtMs < Date.now()) { cache.delete(key); return undefined; }
  return entry;
}

function cacheSet(key: string, value: LinkPreviewResult | null): void {
  // Map preserves insertion order — the first one in is the oldest.
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  const ttl = value && hasContent(value) ? CACHE_TTL_MS : EMPTY_CACHE_TTL_MS;
  cache.set(key, { value, expiresAtMs: Date.now() + ttl });
}

// per-user rate limit — only counts when we actually need to fetch a NEW
// url (a cache hit is free, see fetchLinkPreviewData). Without this,
// pasting several different links fast could open dozens of outbound
// connections per second. Fixed window, not a token bucket — traffic here
// is low enough that the extra precision isn't worth the complexity.
export const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const rateLimitState = new Map<string, { count: number; windowStartMs: number }>(); // userId -> { count, windowStartMs }

export function isRateLimited(userId: string): boolean {
  const now = Date.now();
  const entry = rateLimitState.get(userId);
  if (!entry || now - entry.windowStartMs >= RATE_LIMIT_WINDOW_MS) {
    rateLimitState.set(userId, { count: 1, windowStartMs: now });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT_MAX;
}

/** A preview as it goes to a browser: its pictures through our own proxy.
 * What is cached and stored keeps the original URLs, so the proxy can be
 * switched off, or its key replaced, without touching stored messages. */
export function withProxiedImages(preview: LinkPreviewResult): LinkPreviewResult {
  const sent = { ...preview, image: proxiedImageUrl('preview', preview.image), favicon: proxiedImageUrl('preview', preview.favicon) };
  // rows stored before `images` existed have none to proxy
  if (preview.images) sent.images = preview.images.map((src) => proxiedImageUrl('preview', src)).filter((src): src is string => !!src);
  return sent;
}

/** The preview's picture, fetched through the media proxy (whose cache then
 * already holds it for the readers to come): its size as displayed, and a
 * blurred placeholder, made once here instead of by every reader. A picture
 * the proxy refuses keeps whatever the resolver knew: no reader could load it
 * either. */
async function withPictureDetails(preview: LinkPreviewResult | null, userId: string, lookup?: Lookup): Promise<LinkPreviewResult | null> {
  const target = preview?.image ? allowedTarget('preview', preview.image) : null;
  if (!preview || !target) return preview;
  let body: Buffer;
  try {
    ({ body } = await mediaProxy.get(userId, { url: target.href, redirects: PREVIEW_REDIRECTS, lookup }));
  } catch {
    return preview;
  }
  const [size, placeholder] = await Promise.all([readImageDimensions(body), readImagePlaceholder(body)]);
  return {
    ...preview,
    imageWidth: size?.width ?? preview.imageWidth,
    imageHeight: size?.height ?? preview.imageHeight,
    imagePlaceholder: placeholder,
  };
}

// a fetch already under way for a url: a second caller (a reader and the
// server filling in a stored preview, say) joins it instead of fetching again
const inFlight = new Map<string, Promise<LinkPreviewResult | null>>();

/** The preview of a link, or null when it could not be fetched (the site is
 * down, blocked, too slow): the caller decides what a failure looks like.
 * The preview always carries `rawUrl`, whatever form it was cached under.
 * `lookup` is a seam for tests, which can only reach loopback. */
export async function fetchLinkPreviewData(rawUrl: string, userId: string, lookup?: Lookup): Promise<LinkPreviewResult | null> {
  const key = canonicalUrl(rawUrl);
  const forLink = (preview: LinkPreviewResult | null) => (preview ? { ...preview, url: rawUrl } : null);
  const cached = cacheGet(key);
  if (cached) return forLink(cached.value);
  const pending = inFlight.get(key);
  if (pending) return forLink(await pending);

  if (isRateLimited(userId)) {
    throw Object.assign(new Error('Muitos links novos em pouco tempo, tenta de novo daqui a pouco.'), { status: 429, code: 'rate_limited' });
  }

  const fetching = runResolvers({ url: key, lookup })
    .then((preview) => withPictureDetails(preview, userId, lookup))
    .then((preview) => { cacheSet(key, preview); return preview; })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, fetching);
  return forLink(await fetching);
}

async function handleLinkPreview(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const cookies = parseCookies(request.headers.cookie || '');
  const sess = await resolveSession(cookies[config.SESSION_COOKIE]);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');

  const target = (request.query as Record<string, string | undefined>).url;
  if (!target) return sendError(reply, 400, 'missing_url', 'Parametro url obrigatorio.');

  let parsed: URL;
  try { parsed = new URL(target); } catch { return sendError(reply, 400, 'invalid_url', 'URL inválida.'); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return sendError(reply, 400, 'invalid_url', 'So http/https e suportado.');
  }

  // a failed fetch still gets something renderable: the domain-only card,
  // as Discord shows when it can't read a page
  const data = (await fetchLinkPreviewData(target, sess.userId)) ?? emptyResult(target);
  sendJson(reply, 200, withProxiedImages(data));
}

export function registerLinkPreviewRoutes(fastify: FastifyInstance): void {
  fastify.get('/api/link-preview', handleLinkPreview);
}
