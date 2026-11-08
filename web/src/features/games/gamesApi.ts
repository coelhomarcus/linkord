import { apiFetch } from '@/shared/api/api';
import type { GameItem } from './types';

/** Games matching `query` from IGDB, through our server, which holds the key and the rate limits. */
export function searchGames(query: string, signal?: AbortSignal) {
  return apiFetch<{ games: GameItem[] }>(`/api/games/search?${new URLSearchParams({ q: query })}`, { signal });
}
