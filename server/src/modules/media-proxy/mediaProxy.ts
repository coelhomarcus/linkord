import type { IncomingMessage } from 'node:http';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import sharp from 'sharp';
import { config } from '../../config/env.js';
import { parseCookies } from '../../http/cookies.js';
import { sendError } from '../../http/respond.js';
import { requestSafe } from '../../net/safeRequest.js';
import { allow, retryAfterMs } from '../../realtime/floodControl.js';
import { resolveSession } from '../auth/session.js';
import { igdbCoverUpstream, MEDIA_PROXY_PATH, verifiedTarget, VIDEO_KINDS, youtubeThumbnailUpstream } from './mediaProxyUrls.js';
import { etagOf, InvalidVariantError, parseVariant, PixelLimitError, renderVariant, variantKey, type Picture, type Variant } from './mediaVariants.js';

// GET /api/media-proxy/... — third-party pictures served from our own domain,
// so they show on networks that block those services and never tell them who
// is looking. What may be fetched is decided in mediaProxyUrls.ts; this is the
// fetching: through net/safeRequest.ts (SSRF), capped in time and size,
// checked to really be a picture, cached, and rate limited on cache misses.
// A request may ask for a smaller or WebP variant (mediaVariants.ts), made
// from the cached original and cached beside it. Video kinds (a Steam mini
// profile's background loop) go through a second cache of their own, read
// whole like a picture and served by byte range, as video players ask.

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 8000;
// a preview's picture may sit behind a redirect or two; the fixed hosts answer
// directly, and a redirect there could only lead somewhere else
export const PREVIEW_REDIRECTS = 3;
// covers and avatars change rarely, and a changed one gets a new URL
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_MAX_BYTES = 64 * 1024 * 1024;
// a missing picture (a site's absent /favicon.ico, a removed cover) is asked
// for by every reader: it is remembered for a while instead of fetched again
const FAILURE_TTL_MS = 30 * 60 * 1000;
const FAILURE_MAX_ENTRIES = 2000;
const BROWSER_MAX_AGE_S = 7 * 24 * 60 * 60;
const REDIRECT_MAX_AGE_S = 24 * 60 * 60;
// only fetches that miss the cache count: a Wall full of covers others have
// already seen costs nothing
export const USER_RULE = { windowMs: 60_000, max: 120 };
const GLOBAL_RULE = { windowMs: 60_000, max: 1200 };
const ACCEPT = 'image/avif,image/webp,image/png,image/jpeg,image/gif,image/x-icon;q=0.9,image/*;q=0.5';
// An SVG is a document that can carry script, and this is served from our own
// origin, so it is never passed on: it is drawn into a PNG instead (many sites'
// only favicon is one). librsvg, given bytes with no base path, loads nothing
// the SVG references.
const MAX_SVG_BYTES = 1024 * 1024;
const SVG_RENDER_PX = 512;
const SVG_RENDER_TIMEOUT_S = 3;
// a mini profile background is a short loop of a few megabytes
export const MAX_VIDEO_BYTES = 16 * 1024 * 1024;
const VIDEO_FETCH_TIMEOUT_MS = 20_000;
const VIDEO_CACHE_MAX_BYTES = 64 * 1024 * 1024;
const VIDEO_ACCEPT = 'video/webm,video/mp4;q=0.9';

type Lookup = Parameters<typeof requestSafe>[4];

export type ProxiedImage = Picture;
export interface Upstream {
  url: string;
  redirects: number;
  /** a seam for tests, which can only reach loopback; not part of the cache key */
  lookup?: Lookup;
}
type FailureCode = 'image_unavailable' | 'not_an_image' | 'image_too_large' | 'video_unavailable' | 'not_a_video' | 'video_too_large';

export class MediaProxyError extends Error {
  readonly status: 413 | 415 | 429 | 502;
  readonly code: FailureCode | 'rate_limited';
  readonly retryAfterMs: number;
  constructor(code: MediaProxyError['code'], retryAfterMs = 0) {
    super(code);
    this.code = code;
    this.status = code === 'rate_limited' ? 429 : code.endsWith('_too_large') ? 413 : code.startsWith('not_a') ? 415 : 502;
    this.retryAfterMs = retryAfterMs;
  }
}

/** The type the bytes really are, or null for anything that is not a raster
 * picture: the upstream's Content-Type is a claim, not a fact. */
export function sniffImageType(bytes: Buffer): string | null {
  const ascii = (start: number, end: number) => bytes.subarray(start, end).toString('latin1');
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 6 && (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a')) return 'image/gif';
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (bytes.length >= 12 && ascii(4, 8) === 'ftyp' && ['avif', 'avis'].includes(ascii(8, 12))) return 'image/avif';
  if (bytes.length >= 6 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0 && bytes.readUInt16LE(4) > 0) return 'image/x-icon';
  return null;
}

/** The type a video's bytes really are: WebM (any EBML stream) or MP4, else null. */
export function sniffVideoType(bytes: Buffer): 'video/webm' | 'video/mp4' | null {
  if (bytes.length >= 4 && bytes.readUInt32BE(0) === 0x1a45dfa3) return 'video/webm';
  const brand = bytes.subarray(8, 12).toString('latin1');
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString('latin1') === 'ftyp' && brand !== 'avif' && brand !== 'avis') return 'video/mp4';
  return null;
}

/** An SVG as a PNG, or null when it is not one sharp can draw. */
export async function rasterizeSvg(bytes: Buffer): Promise<Buffer | null> {
  if (bytes.length > MAX_SVG_BYTES || !/<svg[\s>]/i.test(bytes.subarray(0, 4096).toString('utf8'))) return null;
  try {
    return await sharp(bytes).resize(SVG_RENDER_PX, SVG_RENDER_PX, { fit: 'inside' }).png().timeout({ seconds: SVG_RENDER_TIMEOUT_S }).toBuffer();
  } catch {
    return null;
  }
}

const imageOf = (body: Buffer, contentType: string): ProxiedImage => ({ body, contentType, etag: etagOf(body) });

/** One picture from upstream, read whole (up to the cap) and checked. `lookup`
 * is a seam for tests, which can only reach loopback. */
export function fetchImage(upstream: Upstream, lookup?: Lookup): Promise<ProxiedImage> {
  return requestSafe<ProxiedImage>(upstream.url, upstream.redirects, ACCEPT, (res: IncomingMessage, _finalUrl, resolve, reject) => {
    const fail = (code: FailureCode) => { res.destroy(); reject(new MediaProxyError(code)); };
    if (!/^image\//i.test(String(res.headers['content-type'] || ''))) return fail('not_an_image');
    if (Number(res.headers['content-length']) > MAX_IMAGE_BYTES) return fail('image_too_large');
    const chunks: Buffer[] = [];
    let length = 0;
    let done = false;
    const finish = (action: () => void) => { if (done) return; done = true; clearTimeout(deadline); action(); };
    // the request's own timeout only covers silence; this bounds a slow trickle
    const deadline = setTimeout(() => finish(() => fail('image_unavailable')), FETCH_TIMEOUT_MS);
    res.on('data', (chunk: Buffer) => {
      if (done) return;
      length += chunk.length;
      if (length > MAX_IMAGE_BYTES) return finish(() => fail('image_too_large'));
      chunks.push(chunk);
    });
    const svg = /^image\/svg\+xml\b/i.test(String(res.headers['content-type']));
    res.on('end', () => finish(() => {
      const body = Buffer.concat(chunks, length);
      const contentType = sniffImageType(body);
      if (contentType) return resolve(imageOf(body, contentType));
      if (!svg) return reject(new MediaProxyError('not_an_image'));
      void rasterizeSvg(body).then((png) => (png ? resolve(imageOf(png, 'image/png')) : reject(new MediaProxyError('not_an_image'))));
    }));
    res.on('error', () => finish(() => reject(new MediaProxyError('image_unavailable'))));
  }, lookup, FETCH_TIMEOUT_MS).catch((error: unknown) => {
    throw error instanceof MediaProxyError ? error : new MediaProxyError('image_unavailable');
  });
}

/** One video from upstream, read whole (up to the cap) and checked like a picture. */
export function fetchVideo(upstream: Upstream, lookup?: Lookup): Promise<ProxiedImage> {
  return requestSafe<ProxiedImage>(upstream.url, upstream.redirects, VIDEO_ACCEPT, (res: IncomingMessage, _finalUrl, resolve, reject) => {
    const fail = (code: FailureCode) => { res.destroy(); reject(new MediaProxyError(code)); };
    if (!/^video\//i.test(String(res.headers['content-type'] || ''))) return fail('not_a_video');
    if (Number(res.headers['content-length']) > MAX_VIDEO_BYTES) return fail('video_too_large');
    const chunks: Buffer[] = [];
    let length = 0;
    let done = false;
    const finish = (action: () => void) => { if (done) return; done = true; clearTimeout(deadline); action(); };
    const deadline = setTimeout(() => finish(() => fail('video_unavailable')), VIDEO_FETCH_TIMEOUT_MS);
    res.on('data', (chunk: Buffer) => {
      if (done) return;
      length += chunk.length;
      if (length > MAX_VIDEO_BYTES) return finish(() => fail('video_too_large'));
      chunks.push(chunk);
    });
    res.on('end', () => finish(() => {
      const body = Buffer.concat(chunks, length);
      const contentType = sniffVideoType(body);
      if (contentType) resolve(imageOf(body, contentType));
      else reject(new MediaProxyError('not_a_video'));
    }));
    res.on('error', () => finish(() => reject(new MediaProxyError('video_unavailable'))));
  }, lookup, VIDEO_FETCH_TIMEOUT_MS).catch((error: unknown) => {
    throw error instanceof MediaProxyError ? error : new MediaProxyError('video_unavailable');
  });
}

export interface MediaProxyDeps {
  fetch?: (upstream: Upstream) => Promise<ProxiedImage>;
  now?: () => number;
  /** the cache's byte budget */
  maxBytes?: number;
}

/** The cache in front of `fetch`: pictures by upstream URL (a variant by URL
 * and variant), least recently used dropped first once over the byte budget;
 * failures remembered briefly; a picture already being fetched or rendered
 * shared by everyone asking for it. */
export function createMediaProxy({ fetch = (upstream) => fetchImage(upstream, upstream.lookup), now = Date.now, maxBytes = CACHE_MAX_BYTES }: MediaProxyDeps = {}) {
  // keyed by upstream URL, or URL + '\n' + variant key
  const cache = new Map<string, { image: ProxiedImage; expiresAt: number }>();
  const failures = new Map<string, { code: FailureCode; expiresAt: number }>();
  const inFlight = new Map<string, Promise<ProxiedImage>>();
  let cachedBytes = 0;

  const drop = (url: string) => {
    const entry = cache.get(url);
    if (!entry) return;
    cachedBytes -= entry.image.body.length;
    cache.delete(url);
  };
  const store = (url: string, image: ProxiedImage) => {
    drop(url);
    cache.set(url, { image, expiresAt: now() + CACHE_TTL_MS });
    cachedBytes += image.body.length;
    // Map keeps insertion order, and a hit re-inserts: the first is the stalest
    for (const oldest of cache.keys()) {
      if (cachedBytes <= maxBytes) break;
      drop(oldest);
    }
  };
  const remember = (url: string, code: FailureCode) => {
    if (failures.size >= FAILURE_MAX_ENTRIES) failures.delete(failures.keys().next().value!);
    failures.set(url, { code, expiresAt: now() + FAILURE_TTL_MS });
  };

  const cached = (key: string): ProxiedImage | null => {
    const hit = cache.get(key);
    if (hit && hit.expiresAt > now()) {
      cache.delete(key);
      cache.set(key, hit);
      return hit.image;
    }
    drop(key);
    const failed = failures.get(key);
    if (failed && failed.expiresAt > now()) throw new MediaProxyError(failed.code);
    failures.delete(key);
    return null;
  };
  // only work counts: a picture or a variant others already asked for is free
  const spend = (userId: string) => {
    const userKey = `media-proxy:${userId}`;
    if (!allow(userKey, USER_RULE)) throw new MediaProxyError('rate_limited', retryAfterMs(userKey, USER_RULE));
    if (!allow('media-proxy', GLOBAL_RULE)) throw new MediaProxyError('rate_limited', retryAfterMs('media-proxy', GLOBAL_RULE));
  };
  const once = (key: string, work: () => Promise<ProxiedImage>): Promise<ProxiedImage> => {
    const request = work()
      .then((image) => { store(key, image); return image; })
      .catch((error: unknown) => {
        const failure = error instanceof MediaProxyError ? error : new MediaProxyError('image_unavailable');
        if (failure.code !== 'rate_limited') remember(key, failure.code as FailureCode);
        throw failure;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, request);
    return request;
  };

  async function original(userId: string, upstream: Upstream): Promise<ProxiedImage> {
    const hit = cached(upstream.url);
    if (hit) return hit;
    const pending = inFlight.get(upstream.url);
    if (pending) return pending;
    spend(userId);
    return once(upstream.url, () => fetch(upstream));
  }

  return {
    /** The picture, or its `variant` when one is asked for. */
    async get(userId: string, upstream: Upstream, variant: Variant | null = null): Promise<ProxiedImage> {
      if (!variant) return original(userId, upstream);
      const key = `${upstream.url}\n${variantKey(variant)}`;
      const hit = cached(key);
      if (hit) return hit;
      const pending = inFlight.get(key);
      if (pending) return pending;
      const source = await original(userId, upstream);
      const joined = inFlight.get(key);
      if (joined) return joined;
      spend(userId);
      return once(key, () => renderVariant(source, variant).catch((error: unknown) => {
        throw error instanceof PixelLimitError ? new MediaProxyError('image_too_large') : error;
      }));
    },
    /** Bytes held, for tests. */
    get cachedBytes() { return cachedBytes; },
  };
}

type MediaProxy = ReturnType<typeof createMediaProxy>;

/** The one cache of the process: the routes serve from it, and the link
 * preview fills it while it unfurls, so a card's picture is already there
 * when the first reader asks for it. */
export const mediaProxy: MediaProxy = createMediaProxy();
/** The videos' cache, apart so a few loops never push the pictures out. */
const videoProxy: MediaProxy = createMediaProxy({ fetch: (upstream) => fetchVideo(upstream, upstream.lookup), maxBytes: VIDEO_CACHE_MAX_BYTES });

const MESSAGES: Record<MediaProxyError['code'], string> = {
  rate_limited: 'Muitas imagens novas em pouco tempo. Tente novamente em instantes.',
  image_unavailable: 'Não foi possível carregar a imagem.',
  not_an_image: 'O endereço não é uma imagem.',
  image_too_large: 'A imagem é grande demais.',
  video_unavailable: 'Não foi possível carregar o vídeo.',
  not_a_video: 'O endereço não é um vídeo.',
  video_too_large: 'O vídeo é grande demais.',
};

/** The one byte range a request asks for: null for the whole body (no Range,
 * or one we may ignore, like several ranges), 'unsatisfiable' past the end. */
export function parseRange(header: unknown, size: number): { start: number; end: number } | null | 'unsatisfiable' {
  if (typeof header !== 'string') return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return null;
  if (!match[1]) {
    const suffix = Number(match[2]);
    return suffix > 0 && size > 0 ? { start: Math.max(0, size - suffix), end: size - 1 } : 'unsatisfiable';
  }
  const start = Number(match[1]);
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  return start < size && start <= end ? { start, end } : 'unsatisfiable';
}

export interface MediaProxyRouteDeps {
  proxy?: MediaProxy;
  videos?: MediaProxy;
  authenticate?: (request: FastifyRequest) => Promise<string | null>;
  enabled?: boolean;
}

const sessionUserId = async (request: FastifyRequest) =>
  (await resolveSession(parseCookies(request.headers.cookie || '')[config.SESSION_COOKIE]))?.userId ?? null;

export function registerMediaProxyRoutes(app: FastifyInstance, deps: MediaProxyRouteDeps = {}): void {
  const { proxy = mediaProxy, videos = videoProxy, authenticate = sessionUserId, enabled = config.MEDIA_PROXY_ENABLED } = deps;

  async function serve(request: FastifyRequest, reply: FastifyReply, upstream: Upstream | null, video = false): Promise<void> {
    const userId = await authenticate(request);
    if (!userId) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');
    if (!upstream) return sendError(reply, 404, 'not_found', 'Imagem não encontrada.');
    let variant: Variant | null;
    try {
      variant = parseVariant(request.query as Record<string, unknown>);
    } catch (error) {
      if (!(error instanceof InvalidVariantError)) throw error;
      return sendError(reply, 400, 'invalid_variant', 'Variação de imagem inválida.');
    }
    if (video && variant) return sendError(reply, 400, 'invalid_variant', 'Vídeos não têm variações.');
    if (!enabled) {
      // switched off: the browser goes to the service itself, as before the proxy
      reply.header('Cache-Control', `private, max-age=${REDIRECT_MAX_AGE_S}`);
      return reply.redirect(upstream.url, 302);
    }
    let image: ProxiedImage;
    try {
      image = await (video ? videos : proxy).get(userId, upstream, variant);
    } catch (error) {
      if (!(error instanceof MediaProxyError)) throw error;
      if (error.status === 429) reply.header('Retry-After', String(Math.max(1, Math.ceil(error.retryAfterMs / 1000))));
      return sendError(reply, error.status, error.code, MESSAGES[error.code]);
    }
    reply
      .header('Cache-Control', `private, max-age=${BROWSER_MAX_AGE_S}`)
      .header('ETag', image.etag)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cross-Origin-Resource-Policy', 'same-origin');
    const tags = String(request.headers['if-none-match'] || '').split(',').map((tag) => tag.trim().replace(/^W\//, ''));
    if (tags.includes(image.etag)) return reply.code(304).send();
    if (video) {
      reply.header('Accept-Ranges', 'bytes');
      // a range asked for "if still this version" of another version gets the whole new one
      const ifRange = request.headers['if-range'];
      const range = ifRange && ifRange !== image.etag ? null : parseRange(request.headers.range, image.body.length);
      if (range === 'unsatisfiable') {
        reply.header('Content-Range', `bytes */${image.body.length}`);
        return sendError(reply, 416, 'range_not_satisfiable', 'Intervalo inválido.');
      }
      if (range) {
        const part = image.body.subarray(range.start, range.end + 1);
        return reply.code(206).header('Content-Type', image.contentType).header('Content-Length', part.length)
          .header('Content-Range', `bytes ${range.start}-${range.end}/${image.body.length}`).send(part);
      }
    }
    return reply.code(200).header('Content-Type', image.contentType).header('Content-Length', image.body.length).send(image.body);
  }

  app.get<{ Params: { size: string; imageId: string } }>(`${MEDIA_PROXY_PATH}/igdb/:size/:imageId`, (request, reply) => {
    const url = igdbCoverUpstream(request.params.size, request.params.imageId);
    return serve(request, reply, url ? { url, redirects: 0 } : null);
  });
  app.get<{ Params: { videoId: string } }>(`${MEDIA_PROXY_PATH}/youtube/:videoId`, (request, reply) => {
    const url = youtubeThumbnailUpstream(request.params.videoId);
    return serve(request, reply, url ? { url, redirects: 0 } : null);
  });
  app.get<{ Params: { kind: string; signature: string }; Querystring: { u?: unknown } }>(`${MEDIA_PROXY_PATH}/:kind/:signature`, (request, reply) => {
    const { kind, signature } = request.params;
    const url = verifiedTarget(kind, signature, request.query.u);
    return serve(request, reply, url ? { url: url.href, redirects: kind === 'preview' ? PREVIEW_REDIRECTS : 0 } : null, VIDEO_KINDS.includes(kind));
  });
}
