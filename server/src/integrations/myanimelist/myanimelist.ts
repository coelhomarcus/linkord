import type { ConnectionSnapshot, MediaItem } from '../../modules/connections/types.js';
import { ConnectionFetchError, imageUrl, list, numberValue, record, textValue, type RequestJson } from '../connectionHttp.js';

// The wall's status labels predate the official API and are matched by the web client.
const STATUS_LABELS: Record<string, string> = {
  watching: 'Watching', completed: 'Completed', on_hold: 'On-Hold', dropped: 'Dropped', plan_to_watch: 'Plan to Watch',
};

function recentAnime(value: unknown): MediaItem {
  const source = record(value);
  const node = record(source.node);
  const status = source.list_status ? record(source.list_status) : {};
  const id = numberValue(node.id);
  const title = textValue(node.title);
  if (id === null || !title) throw new ConnectionFetchError('invalid_response');
  const picture = node.main_picture ? record(node.main_picture) : {};
  const total = numberValue(node.num_episodes);
  return {
    id: String(id), title, url: `https://myanimelist.net/anime/${id}`,
    imageUrl: imageUrl(picture.medium, 'cdn.myanimelist.net'),
    status: STATUS_LABELS[textValue(status.status) ?? ''] ?? null,
    progress: numberValue(status.num_episodes_watched),
    // the API reports 0 episodes while the total is still unknown
    total: total || null,
  };
}

/** Reads a public anime list through the official MyAnimeList API, which needs only an application client ID. */
export async function fetchMyAnimeList(username: string, request: RequestJson, clientId: string): Promise<ConnectionSnapshot> {
  if (!clientId) throw new ConnectionFetchError('unavailable');
  const query = new URLSearchParams({ sort: 'list_updated_at', limit: '10', fields: 'list_status,num_episodes' });
  const response = record(await request(
    `https://api.myanimelist.net/v2/users/${encodeURIComponent(username)}/animelist?${query}`,
    { headers: { 'X-MAL-CLIENT-ID': clientId } },
  ));
  return { widgets: {
    'mal-recent-anime': { kind: 'list', items: list(response.data).slice(0, 10).map(recentAnime) },
  } };
}
