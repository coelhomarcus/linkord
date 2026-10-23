import type { IncomingMessage } from 'node:http';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sendJson, sendError } from '../../http/respond.js';
import { sessionTokenFromHeaders } from '../../http/cookies.js';
import { resolveSession } from '../auth/session.js';
import { requestSafe } from '../../net/safeRequest.js';
import { readImageDimensions } from '../attachments/attachmentThumbnails.js';

// GET /api/link-preview?url=<url> — server-side fetch (avoids CORS) for a
// generic link's Open Graph tags. This means the server fetches a URL
// chosen by whoever sends the chat message — classic SSRF risk. Defense:
// every outbound request goes through net/safeRequest.ts (IP validated at
// CONNECTION time, redirects revalidated on each hop, capped at 3); the
// body read has byte and time caps.

const IMAGE_PROBE_TIMEOUT_MS = 3000;
// A picture's size is in its first bytes; this much is read, never more
const IMAGE_PROBE_MAX_BYTES = 256 * 1024;
// the first attempt to read the size, then every 4x until the cap
const IMAGE_PROBE_FIRST_TRY_BYTES = 16 * 1024;
// the formats sharp reads a size from here; an SVG is code, not worth parsing
const PROBED_IMAGE_TYPES = /^image\/(png|jpe?g|gif|webp|avif)\b/i;
// safety net for a malformed page with no `</head>` — the real cutoff is
// semantic; YouTube's head alone can be ~700KB before the first OG tag.
const MAX_BODY_BYTES = 1.5 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h — same link, same preview for everyone
const CACHE_MAX_ENTRIES = 500;
const HEAD_CLOSE_RE = /<\/head/i;

export interface LinkPreviewResult {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  video: string | null;
  favicon: string | null;
  siteName: string;
  themeColor: string | null;
  /** Pixel size of `image` (as displayed), so the client can reserve the
   * box before it loads; null when it could not be read. */
  imageWidth: number | null;
  imageHeight: number | null;
}

interface CacheEntry {
  value: LinkPreviewResult;
  expiresAtMs: number;
}

const cache = new Map<string, CacheEntry>(); // url -> { value, expiresAtMs }

function cacheGet(url: string): LinkPreviewResult | undefined {
  const entry = cache.get(url);
  if (!entry) return undefined;
  if (entry.expiresAtMs < Date.now()) { cache.delete(url); return undefined; }
  return entry.value;
}

function cacheSet(url: string, value: LinkPreviewResult): void {
  // Map preserves insertion order — the first one in is the oldest.
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  cache.set(url, { value, expiresAtMs: Date.now() + CACHE_TTL_MS });
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

type Lookup = Parameters<typeof requestSafe>[4];
type ImageSize = { width: number; height: number };

/** Reads just enough of an image response to know its size, then stops. Tries
 * early and again as more arrives, so a small picture costs one short read
 * and a big one never costs more than the cap. */
function probeImageBody(res: IncomingMessage, done: (size: ImageSize | null) => void): void {
  const chunks: Buffer[] = [];
  let length = 0;
  let nextTryAt = IMAGE_PROBE_FIRST_TRY_BYTES;
  let trying = false;
  let ended = false;
  let finished = false;
  const finish = (size: ImageSize | null) => {
    if (finished) return;
    finished = true;
    res.destroy();
    done(size);
  };
  const attempt = async () => {
    trying = true;
    const size = await readImageDimensions(Buffer.concat(chunks, length));
    trying = false;
    if (finished) return;
    if (size) return finish(size);
    if (ended || length >= IMAGE_PROBE_MAX_BYTES) return finish(null);
    if (length >= nextTryAt) { nextTryAt *= 4; void attempt(); }
  };
  res.on('data', (chunk: Buffer) => {
    if (finished) return;
    chunks.push(chunk);
    length += chunk.length;
    if (!trying && (length >= nextTryAt || length >= IMAGE_PROBE_MAX_BYTES)) { nextTryAt *= 4; void attempt(); }
  });
  res.on('end', () => { ended = true; if (!finished && !trying) void attempt(); });
  res.on('error', () => finish(null));
}

/** The size of a remote picture, or null. Never throws: a missing size only
 * means the client falls back to a fixed box. */
async function probeImageSize(imageUrl: string, lookup?: Lookup): Promise<ImageSize | null> {
  try {
    return await requestSafe<ImageSize | null>(imageUrl, MAX_REDIRECTS, 'image/*', (res, _finalUrl, resolve) => {
      if (!PROBED_IMAGE_TYPES.test(String(res.headers['content-type'] || ''))) { res.destroy(); return resolve(null); }
      probeImageBody(res, resolve);
    }, lookup, IMAGE_PROBE_TIMEOUT_MS);
  } catch {
    return null;
  }
}

interface FetchedPage {
  html: string;
  finalUrl: string;
  /** set when the URL turned out to be a picture itself, not a page */
  picture?: { size: ImageSize | null };
}

function fetchPage(targetUrl: string, lookup?: Lookup): Promise<FetchedPage> {
  return requestSafe<FetchedPage>(targetUrl, MAX_REDIRECTS, 'text/html,image/*;q=0.8,*/*;q=0.5', (res, finalUrl, resolve, reject) => {
    const contentType = String(res.headers['content-type'] || '');

    if (PROBED_IMAGE_TYPES.test(contentType)) {
      return probeImageBody(res, (size) => resolve({ html: '', finalUrl, picture: { size } }));
    }
    if (!contentType.includes('text/html')) {
      // not a page and not a picture worth sizing: nothing to read, so don't
      // download it (it can be arbitrarily large)
      res.destroy();
      return resolve({ html: '', finalUrl });
    }

    let body = '';
    let bytes = 0;
    let settled = false;
    res.setEncoding('utf8');
    res.on('data', (chunk: string) => {
      if (settled) return;
      bytes += Buffer.byteLength(chunk);
      body += chunk;
      // stop once </head> closes (all OG meta tags live there, never in
      // <body>), or at the byte cap as a safety net for a page with no
      // normal head.
      if (HEAD_CLOSE_RE.test(body) || bytes >= MAX_BODY_BYTES) {
        settled = true;
        res.destroy();
        resolve({ html: body, finalUrl });
      }
    });
    res.on('end', () => { if (!settled) resolve({ html: body, finalUrl }); });
    res.on('error', (err) => { if (!settled) reject(err); });
  }, lookup);
}

const HTML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Pages write meta tag content as HTML (e.g. an apostrophe becomes
 * "&#39;") — without decoding, the card would show the raw entity instead
 * of the actual character. */
export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const codePoint = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : whole;
    }
    return HTML_ENTITIES[code.toLowerCase()] ?? whole;
  });
}

export function extractMetaTags(html: string): Record<string, string> {
  const metas: Record<string, string> = {};
  const metaRe = /<meta\s+[^>]*>/gi;
  let m;
  while ((m = metaRe.exec(html))) {
    const tag = m[0];
    const propM = /(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag);
    const contentM = /content\s*=\s*["']([^"']*)["']/i.exec(tag);
    if (propM && contentM) {
      const key = propM[1]!.toLowerCase();
      if (!(key in metas)) metas[key] = decodeHtmlEntities(contentM[1]!); // first occurrence wins
    }
  }
  return metas;
}

export function extractFavicon(html: string): string | null {
  const iconRe = /<link\s+[^>]*rel\s*=\s*["'](?:shortcut icon|icon|apple-touch-icon)["'][^>]*>/i;
  const tag = iconRe.exec(html)?.[0];
  const hrefM = tag && /href\s*=\s*["']([^"']+)["']/i.exec(tag);
  return hrefM ? hrefM[1]! : null;
}

export function safeResolve(raw: string | null | undefined, base: string): string | null {
  if (!raw) return null;
  try {
    const resolved = new URL(raw, base);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return null;
    return resolved.toString();
  } catch {
    return null;
  }
}

export function emptyResult(rawUrl: string): LinkPreviewResult {
  let hostname = rawUrl;
  try { hostname = new URL(rawUrl).hostname.replace(/^www\./, ''); } catch { /* keep the raw url */ }
  return { url: rawUrl, title: null, description: null, image: null, video: null, favicon: null, siteName: hostname, themeColor: null, imageWidth: null, imageHeight: null };
}

// a fetch already under way for a url: a second caller (a reader and the
// server filling in a stored preview, say) joins it instead of fetching again
const inFlight = new Map<string, Promise<LinkPreviewResult>>();

/** `lookup` is a seam for tests, which can only reach loopback. */
export async function fetchLinkPreviewData(rawUrl: string, userId: string, lookup?: Lookup): Promise<LinkPreviewResult> {
  const cached = cacheGet(rawUrl);
  if (cached !== undefined) return cached;
  const pending = inFlight.get(rawUrl);
  if (pending) return pending;

  if (isRateLimited(userId)) {
    throw Object.assign(new Error('Muitos links novos em pouco tempo, tenta de novo daqui a pouco.'), { status: 429, code: 'rate_limited' });
  }

  const fetching = scrapeLinkPreview(rawUrl, lookup).finally(() => inFlight.delete(rawUrl));
  inFlight.set(rawUrl, fetching);
  return fetching;
}

async function scrapeLinkPreview(rawUrl: string, lookup?: Lookup): Promise<LinkPreviewResult> {
  let result: LinkPreviewResult;
  try {
    const { html, finalUrl, picture } = await fetchPage(rawUrl, lookup);
    if (picture) {
      // a bare image link: no page to read, but the card can still reserve its size
      const pictureResult = { ...emptyResult(rawUrl), image: finalUrl, imageWidth: picture.size?.width ?? null, imageHeight: picture.size?.height ?? null };
      cacheSet(rawUrl, pictureResult);
      return pictureResult;
    }
    const metas = extractMetaTags(html);
    const titleTagM = /<title[^>]*>([^<]*)<\/title>/i.exec(html);

    const title = (metas['og:title'] || metas['twitter:title'] || (titleTagM && decodeHtmlEntities(titleTagM[1]!)) || '').trim() || null;
    const description = (metas['og:description'] || metas['twitter:description'] || metas['description'] || '').trim() || null;
    const image = safeResolve(metas['og:image'] || metas['og:image:url'] || metas['twitter:image'], finalUrl);
    const video = safeResolve(metas['og:video:secure_url'] || metas['og:video:url'] || metas['og:video'], finalUrl);
    const favicon = safeResolve(extractFavicon(html), finalUrl) || safeResolve('/favicon.ico', finalUrl);
    const siteName = (metas['og:site_name'] || '').trim() || new URL(finalUrl).hostname.replace(/^www\./, '');
    const themeColor = (metas['theme-color'] || '').trim() || null;

    const size = image ? await probeImageSize(image, lookup) : null;

    result = { url: rawUrl, title, description, image, video, favicon, siteName, themeColor, imageWidth: size?.width ?? null, imageHeight: size?.height ?? null };
  } catch {
    // scraping failed (blocked, timeout, site down, SSRF blocked) — still
    // return something renderable: a minimal card with just the domain,
    // like Discord does when it can't read metadata.
    result = emptyResult(rawUrl);
  }

  cacheSet(rawUrl, result);
  return result;
}

async function handleLinkPreview(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const sess = await resolveSession(sessionTokenFromHeaders(request.headers));
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');

  const target = (request.query as Record<string, string | undefined>).url;
  if (!target) return sendError(reply, 400, 'missing_url', 'Parametro url obrigatorio.');

  let parsed: URL;
  try { parsed = new URL(target); } catch { return sendError(reply, 400, 'invalid_url', 'URL inválida.'); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return sendError(reply, 400, 'invalid_url', 'So http/https e suportado.');
  }

  const data = await fetchLinkPreviewData(target, sess.userId);
  sendJson(reply, 200, data);
}

export function registerLinkPreviewRoutes(fastify: FastifyInstance): void {
  fastify.get('/api/link-preview', handleLinkPreview);
}
