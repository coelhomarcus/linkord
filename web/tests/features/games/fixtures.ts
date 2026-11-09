import type { GameItem } from '@/features/games/types';

export function game(igdbId: number, extra: Partial<GameItem> = {}): GameItem {
  return {
    igdbId, name: `Game ${igdbId}`, slug: `game-${igdbId}`, coverImageId: `co${igdbId}`, releaseYear: 2000 + igdbId,
    url: `https://www.igdb.com/games/game-${igdbId}`, imageUrl: `/api/media-proxy/igdb/cover_small/co${igdbId}`, ...extra,
  };
}
