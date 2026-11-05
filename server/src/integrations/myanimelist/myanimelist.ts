import type { ConnectionSnapshot, MediaItem } from '../../modules/connections/types.js';
import { ConnectionFetchError, imageUrl, list, numberValue, record, textValue, type RequestJson } from '../connectionHttp.js';

function mediaItem(value: unknown, kind: 'anime' | 'manga' | 'character', recent = false): MediaItem {
  const source = record(value);
  const entry = recent ? record(source.entry) : source;
  const id = numberValue(entry.mal_id);
  const title = textValue(entry.title) ?? textValue(entry.name);
  if (id === null || !title) throw new ConnectionFetchError('invalid_response');
  const images = entry.images ? record(entry.images) : {};
  const jpg = images.jpg ? record(images.jpg) : {};
  const progress = recent ? numberValue(source.episodes_seen) : null;
  return {
    id: String(id), title, url: `https://myanimelist.net/${kind}/${id}`,
    imageUrl: imageUrl(jpg.image_url, 'cdn.myanimelist.net'),
    status: recent ? textValue(source.status) : null,
    progress, total: recent ? numberValue(source.episodes_total) : null,
  };
}
export async function fetchMyAnimeList(username: string, request: RequestJson): Promise<ConnectionSnapshot> {
  const base = `https://api.jikan.moe/v4/users/${encodeURIComponent(username)}`;
  const profile = record(record(await request(base)).data);
  if (!textValue(profile.username)) throw new ConnectionFetchError('invalid_response');
  const favorites = record(record(await request(`${base}/favorites`)).data);
  const updates = record(record(await request(`${base}/userupdates`)).data);
  return { widgets: {
    'mal-recent-anime': { kind: 'list', items: list(updates.anime).slice(0, 10).map((item) => mediaItem(item, 'anime', true)) },
    'mal-favorite-anime': { kind: 'list', items: list(favorites.anime).slice(0, 10).map((item) => mediaItem(item, 'anime')) },
    'mal-favorite-manga': { kind: 'list', items: list(favorites.manga).slice(0, 10).map((item) => mediaItem(item, 'manga')) },
    'mal-favorite-characters': { kind: 'list', items: list(favorites.characters).slice(0, 10).map((item) => mediaItem(item, 'character')) },
  } };
}
