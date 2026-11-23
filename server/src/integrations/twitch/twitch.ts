import { ConnectionFetchError, fetchSafeConnectionJson, list, record, textValue, type RequestJson } from '../connectionHttp.js';
import type { ConnectionSnapshot, TwitchStream, TwitchVideo } from '../../modules/connections/types.js';
import { twitchAppToken, type createAppToken } from './appToken.js';

export const TWITCH_IMAGE_HOSTS = ['static-cdn.jtvnw.net', 'clips-media-assets2.twitch.tv'] as const;
const HELIX = 'https://api.twitch.tv/helix';
const LOGIN = /^[a-z0-9_]{1,25}$/;
const LIVE_TTL_MS = 60_000;

export function parseTwitchLogin(value: string): string | null {
  const login = value.toLowerCase();
  return LOGIN.test(login) ? login : null;
}

function requiredText(value: unknown): string {
  const text = textValue(value);
  if (!text) throw new ConnectionFetchError('invalid_response');
  return text;
}

function numericId(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{1,24}$/.test(value)) throw new ConnectionFetchError('invalid_response');
  return value;
}

function thumbnail(value: unknown, width = 640, height = 360): string | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value.replace(/%?\{width\}/g, String(width)).replace(/%?\{height\}/g, String(height)));
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && (TWITCH_IMAGE_HOSTS as readonly string[]).includes(url.hostname) ? url.href : null;
  } catch { return null; }
}

function video(item: unknown): TwitchVideo {
  const row = record(item);
  const id = numericId(row.id);
  const date = typeof row.created_at === 'string' ? Date.parse(row.created_at) : NaN;
  const match = typeof row.duration === 'string' && /^(?=\d)(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(row.duration);
  if (!Number.isFinite(date) || !match) throw new ConnectionFetchError('invalid_response');
  const seconds = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
  if (!Number.isSafeInteger(seconds)) throw new ConnectionFetchError('invalid_response');
  return {
    id, title: requiredText(row.title), imageUrl: thumbnail(row.thumbnail_url),
    createdAt: new Date(date).toISOString(), seconds, url: `https://www.twitch.tv/videos/${id}`,
  };
}

export function createTwitchClient({
  appToken = twitchAppToken, request = fetchSafeConnectionJson, now = Date.now,
}: { appToken?: ReturnType<typeof createAppToken>; request?: RequestJson; now?: () => number } = {}) {
  async function data(endpoint: string, params: Record<string, string>): Promise<unknown[]> {
    const response = await appToken.authorize((headers) => request(`${HELIX}/${endpoint}?${new URLSearchParams(params)}`, { headers }));
    return list(record(response).data);
  }

  async function stream(login: string): Promise<TwitchStream | null> {
    if (!parseTwitchLogin(login)) throw new ConnectionFetchError('invalid_response');
    const rows = await data('streams', { user_login: login });
    if (rows.length === 0) return null;
    const row = record(rows[0]);
    if (row.user_login !== login || row.type !== 'live' || typeof row.viewer_count !== 'number'
        || !Number.isSafeInteger(row.viewer_count) || row.viewer_count < 0) throw new ConnectionFetchError('invalid_response');
    return { title: requiredText(row.title), game: textValue(row.game_name), viewers: row.viewer_count, imageUrl: thumbnail(row.thumbnail_url) };
  }

  // Read only for published live widgets. Store no live state in the daily snapshot.
  const cache = new Map<string, { expiresAt: number; value: Promise<TwitchStream | null> }>();

  return {
    configured: appToken.configured,
    async profile(login: string): Promise<{ snapshot: ConnectionSnapshot; url: string }> {
      const users = await data('users', { login });
      if (!users.length) throw new ConnectionFetchError('not_found');
      const user = record(users[0]);
      if (user.login !== login) throw new ConnectionFetchError('invalid_response');
      const id = numericId(user.id);
      const name = requiredText(user.display_name);
      const videos = (await data('videos', { user_id: id, type: 'archive', first: '6' })).slice(0, 6).map(video);
      return {
        url: `https://www.twitch.tv/${login}`,
        snapshot: { widgets: {
          'twitch-live': { kind: 'twitch-live', login, name, avatarUrl: thumbnail(user.profile_image_url, 128, 128),
            offlineImageUrl: thumbnail(user.offline_image_url), lastStreamAt: videos[0]?.createdAt ?? null, stream: null, status: 'unknown' },
          'twitch-vods': { kind: 'twitch-vods', items: videos },
        } },
      };
    },
    live(login: string): Promise<TwitchStream | null> {
      const cached = cache.get(login);
      if (cached && cached.expiresAt > now()) return cached.value;
      cache.delete(login);
      if (cache.size >= 500) cache.delete(cache.keys().next().value!);
      const value = stream(login);
      const entry = { expiresAt: now() + LIVE_TTL_MS, value };
      cache.set(login, entry);
      // Briefly cache failures as well, without continuing to report the previous live state.
      void value.catch(() => { entry.expiresAt = now() + 15_000; });
      return value;
    },
  };
}

export const twitch = createTwitchClient();
