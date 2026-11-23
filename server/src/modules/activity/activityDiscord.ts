import type { FastifyReply, FastifyRequest } from 'fastify';
import { sendError, sendJson } from '../../http/respond.js';
import { DISCORD_MEDIA_HOST, isDiscordAppId, type DiscordAppClient } from '../../integrations/discord/discordApps.js';
import * as floodControl from '../../realtime/floodControl.js';

// `POST /api/activity/discord`: what the desktop app asks when a game talks Discord Rich Presence to
// it. The game names only its Discord application id and its images (an asset key, a link, or
// Discord's `mp:external/…`); this answers with the application's name and every picture downloaded
// and stored as an activity icon, so `activity-set` can carry them as `{ local }` like any other icon
// and nobody's browser ever asks Discord or a game's server for anything.

const MAX_DISCORD_IMAGES = 2;
const IMAGE_KEY_MAX = 1024;
const ASSET_KEY = /^[a-z0-9_.-]{1,128}$/;
// a picture already stored is not fetched again for a day; one that failed is retried after a while
const STORED_TTL_MS = 24 * 60 * 60 * 1000;
const FAILED_TTL_MS = 10 * 60 * 1000;
const STORED_MAX_ENTRIES = 5000;
// a fixed host answers directly; a game's own link may sit behind a redirect or two
const LINK_REDIRECTS = 3;
const DISCORD_RULE = { windowMs: 60_000, max: 30 };

export interface DiscordActivityRequest {
  appId: string;
  images: string[];
}

export interface DiscordActivityResult {
  name: string | null;
  /** stored activity icon ids */
  icon: string | null;
  images: Record<string, string | null>;
}

export interface ImageSource {
  url: string;
  redirects: number;
}

export function parseDiscordActivityBody(body: unknown): DiscordActivityRequest | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const { appId, images = [] } = body as { appId?: unknown; images?: unknown };
  if (!isDiscordAppId(appId) || !Array.isArray(images) || images.length > MAX_DISCORD_IMAGES) return null;
  if (!images.every((image) => typeof image === 'string' && image.length > 0 && image.length <= IMAGE_KEY_MAX)) return null;
  return { appId, images: [...new Set(images as string[])] };
}

function httpsUrl(value: string, host?: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || !url.hostname) return null;
    if (host && url.hostname !== host) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** Where an image a game names is, or null when it names nothing that can be fetched. */
export function imageSource(image: string, assets: Map<string, string>): ImageSource | null {
  if (image.startsWith('mp:external/')) {
    const url = httpsUrl(`https://${DISCORD_MEDIA_HOST}/external/${image.slice('mp:external/'.length)}`, DISCORD_MEDIA_HOST);
    return url && new URL(url).pathname.startsWith('/external/') ? { url, redirects: 0 } : null;
  }
  if (/^https:/i.test(image)) {
    const url = httpsUrl(image);
    return url ? { url, redirects: LINK_REDIRECTS } : null;
  }
  const key = image.toLowerCase();
  const asset = ASSET_KEY.test(key) ? assets.get(key) : undefined;
  return asset ? { url: asset, redirects: 0 } : null;
}

export interface DiscordActivityDeps {
  client: DiscordAppClient;
  /** the picture's bytes, through the SSRF guard and a size cap */
  download: (source: ImageSource) => Promise<Buffer>;
  storeIcon: (bytes: Buffer) => Promise<{ id: string } | 'invalid_image' | 'too_large'>;
  now?: () => number;
}

export function createDiscordActivityLookup({ client, download, storeIcon, now = Date.now }: DiscordActivityDeps) {
  const stored = new Map<string, { id: Promise<string | null>; expiresAt: number }>();

  /** The stored icon of the picture at `source`, fetched once for everyone who shows it. */
  function iconOf(source: ImageSource): Promise<string | null> {
    const found = stored.get(source.url);
    if (found && found.expiresAt > now()) return found.id;
    stored.delete(source.url);
    if (stored.size >= STORED_MAX_ENTRIES) stored.delete(stored.keys().next().value!);
    const entry = { id: Promise.resolve<string | null>(null), expiresAt: now() + STORED_TTL_MS };
    entry.id = (async () => {
      try {
        const result = await storeIcon(await download(source));
        if (typeof result === 'object') return result.id;
      } catch {
        // unreachable, refused by the SSRF guard, too large, not a picture: shown without it
      }
      entry.expiresAt = now() + FAILED_TTL_MS;
      return null;
    })();
    stored.set(source.url, entry);
    return entry.id;
  }

  return async ({ appId, images }: DiscordActivityRequest): Promise<DiscordActivityResult> => {
    const [app, assets] = await Promise.all([
      client.app(appId),
      images.some((image) => !image.startsWith('mp:') && !/^https:/i.test(image)) ? client.assets(appId) : Promise.resolve(new Map<string, string>()),
    ]);
    const icon = app?.icon ? iconOf({ url: app.icon, redirects: 0 }) : Promise.resolve(null);
    const pictures = images.map((image) => {
      const source = imageSource(image, assets);
      return source ? iconOf(source) : Promise.resolve(null);
    });
    const [iconId, ...imageIds] = await Promise.all([icon, ...pictures]);
    return { name: app?.name ?? null, icon: iconId ?? null, images: Object.fromEntries(images.map((image, i) => [image, imageIds[i] ?? null])) };
  };
}

export type DiscordActivityLookup = ReturnType<typeof createDiscordActivityLookup>;

/** The route's handler; `session` answers 401 itself when there is none. */
export function createDiscordActivityHandler(deps: {
  session: (request: FastifyRequest, reply: FastifyReply) => Promise<{ userId: string } | null>;
  lookup: DiscordActivityLookup;
}) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const sess = await deps.session(request, reply);
    if (!sess) return;
    const key = `activity-discord:${sess.userId}`;
    if (!floodControl.allow(key, DISCORD_RULE)) {
      reply.header('Retry-After', String(Math.max(1, Math.ceil(floodControl.retryAfterMs(key, DISCORD_RULE) / 1000))));
      return sendError(reply, 429, 'rate_limited', 'Muitas buscas. Tente novamente em instantes.');
    }
    const body = parseDiscordActivityBody(request.body);
    if (!body) return sendError(reply, 400, 'invalid_request', 'Busca inválida.');
    sendJson(reply, 200, await deps.lookup(body));
  };
}
