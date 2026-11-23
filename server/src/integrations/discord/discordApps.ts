import { ConnectionFetchError, fetchConnectionJson, list, record, textValue, type RequestJson } from '../connectionHttp.js';

// Discord's public application API: the name and icon of a Discord application, and the images it
// uploaded for Rich Presence. A game that talks Rich Presence to the desktop app names only its
// application id and its images' keys (modules/activity/activityDiscord.ts turns those into a name
// and stored icons). Both endpoints answer without a credential; only the application id is sent.

const API_BASE = 'https://discord.com/api/v10';
const DISCORD_CDN_HOST = 'cdn.discordapp.com';
export const DISCORD_MEDIA_HOST = 'media.discordapp.net';
const APP_ID = /^\d{17,20}$/;
const ICON_HASH = /^(a_)?[0-9a-f]{32}$/;
const ASSET_ID = /^\d{17,20}$/;
const NAME_MAX = 128;
const ASSETS_MAX = 500;
// an application's name, icon and assets change rarely; a new image key a game starts using shows
// without its picture until the entry expires
const TTL_MS = 24 * 60 * 60 * 1000;
// Discord down or limiting us is not an answer: asked again sooner than a missing application
const FAILURE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 2000;

interface DiscordApp {
  name: string;
  /** the application's icon on Discord's CDN, or null */
  icon: string | null;
}

export interface DiscordAppClient {
  /** The application, or null when Discord does not know it (or could not be asked). */
  app(appId: string): Promise<DiscordApp | null>;
  /** Its Rich Presence images: asset name (lowercase) and asset id, each to its picture on Discord's CDN. */
  assets(appId: string): Promise<Map<string, string>>;
}

export function isDiscordAppId(value: unknown): value is string {
  return typeof value === 'string' && APP_ID.test(value);
}

function cleanName(value: unknown): string | null {
  const text = textValue(value);
  if (!text) return null;
  const name = Array.from(text.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim()).slice(0, NAME_MAX).join('').trim();
  return name || null;
}

function parseApp(appId: string, value: unknown): DiscordApp | null {
  const body = record(value);
  const name = cleanName(body.name);
  if (!name) return null;
  const hash = typeof body.icon === 'string' && ICON_HASH.test(body.icon) ? body.icon : null;
  return { name, icon: hash ? `https://${DISCORD_CDN_HOST}/app-icons/${appId}/${hash}.png?size=256` : null };
}

function parseAssets(appId: string, value: unknown): Map<string, string> {
  const assets = new Map<string, string>();
  for (const item of list(value).slice(0, ASSETS_MAX)) {
    if (!item || typeof item !== 'object') continue;
    const { id, name } = item as Record<string, unknown>;
    if (typeof id !== 'string' || !ASSET_ID.test(id)) continue;
    const url = `https://${DISCORD_CDN_HOST}/app-assets/${appId}/${id}.png`;
    assets.set(id, url);
    if (typeof name === 'string' && name) assets.set(name.toLowerCase(), url);
  }
  return assets;
}

interface Entry<T> { value: Promise<T>; expiresAt: number }

/** A read remembered for `TTL_MS` (an answer, "not found" included) or `FAILURE_TTL_MS` (no answer),
 * shared by everyone asking while it is in flight. */
function createCache<T>(now: () => number) {
  const entries = new Map<string, Entry<T>>();
  return (key: string, read: () => Promise<T>, fallback: T): Promise<T> => {
    const found = entries.get(key);
    if (found && found.expiresAt > now()) return found.value;
    entries.delete(key);
    if (entries.size >= CACHE_MAX_ENTRIES) entries.delete(entries.keys().next().value!);
    const entry: Entry<T> = { value: Promise.resolve(fallback), expiresAt: now() + TTL_MS };
    entry.value = read().catch((error: unknown) => {
      if (!(error instanceof ConnectionFetchError) || error.code !== 'not_found') {
        entry.expiresAt = now() + Math.max(FAILURE_TTL_MS, error instanceof ConnectionFetchError ? error.retryAfterMs : 0);
      }
      return fallback;
    });
    entries.set(key, entry);
    return entry.value;
  };
}

export function createDiscordAppClient(options: { request?: RequestJson; now?: () => number } = {}): DiscordAppClient {
  const { request = fetchConnectionJson, now = Date.now } = options;
  const apps = createCache<DiscordApp | null>(now);
  const assetMaps = createCache<Map<string, string>>(now);
  const get = (path: string) => request(`${API_BASE}${path}`, { headers: { Accept: 'application/json' } });

  return {
    app(appId) {
      if (!isDiscordAppId(appId)) return Promise.resolve(null);
      return apps(appId, async () => parseApp(appId, await get(`/applications/${appId}/rpc`)), null);
    },
    assets(appId) {
      if (!isDiscordAppId(appId)) return Promise.resolve(new Map());
      return assetMaps(appId, async () => parseAssets(appId, await get(`/oauth2/applications/${appId}/assets`)), new Map());
    },
  };
}
