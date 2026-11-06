import type { ConnectionSnapshot, MediaItem } from '../../modules/connections/types.js';
import { ConnectionFetchError, imageUrl, list, numberValue, record, textValue, type RequestJson } from '../connectionHttp.js';

// The widget is a 4x2 grid of covers
const RECENT_LIMIT = 8;

function recentAnime(value: unknown): MediaItem {
  const node = record(record(value).node);
  const id = numberValue(node.id);
  const title = textValue(node.title);
  if (id === null || !title) throw new ConnectionFetchError('invalid_response');
  const picture = node.main_picture ? record(node.main_picture) : {};
  return { id: String(id), title, url: `https://myanimelist.net/anime/${id}`, imageUrl: imageUrl(picture.medium, 'cdn.myanimelist.net') };
}

/** Reads a public anime list through the official MyAnimeList API, which needs only an application client ID. */
export async function fetchMyAnimeList(username: string, request: RequestJson, clientId: string): Promise<ConnectionSnapshot> {
  if (!clientId) throw new ConnectionFetchError('unavailable');
  const query = new URLSearchParams({ sort: 'list_updated_at', limit: String(RECENT_LIMIT) });
  const response = record(await request(
    `https://api.myanimelist.net/v2/users/${encodeURIComponent(username)}/animelist?${query}`,
    { headers: { 'X-MAL-CLIENT-ID': clientId } },
  ));
  return { widgets: {
    'mal-recent-anime': { kind: 'list', items: list(response.data).slice(0, RECENT_LIMIT).map(recentAnime) },
  } };
}
