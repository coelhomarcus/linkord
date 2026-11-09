import { igdbCoverProxyUrl } from '@/shared/lib/mediaProxy';

const GAME_LISTS = ['favorite', 'liked', 'playing', 'wishlist'] as const;
export type GameList = (typeof GAME_LISTS)[number];

/** The Wall widget that shows each list. Mirrors `modules/games/types.ts` on the server. */
const GAME_WIDGET_TYPES = {
  favorite: 'igdb-favorite-game',
  liked: 'igdb-liked-games',
  playing: 'igdb-playing-games',
  wishlist: 'igdb-wishlist-games',
} as const satisfies Record<GameList, string>;
export type GameWidgetType = (typeof GAME_WIDGET_TYPES)[GameList];

export const GAME_LIST_LIMITS: Record<GameList, number> = { favorite: 1, liked: 8, playing: 8, wishlist: 8 };

export interface GameItem {
  igdbId: number;
  name: string;
  slug: string;
  coverImageId: string | null;
  releaseYear: number | null;
  url: string;
  imageUrl: string | null;
}
export type GameLists = Record<GameList, GameItem[]>;

export function gameListOf(type: string): GameList | null {
  return GAME_LISTS.find((list) => GAME_WIDGET_TYPES[list] === type) ?? null;
}

/** The fields the server keeps; it builds the link and the cover itself. */
export function gameSnapshot({ igdbId, name, slug, coverImageId, releaseYear }: GameItem) {
  return { igdbId, name, slug, coverImageId, releaseYear };
}

/** A game just picked from the search, which carries the small cover, ready for a widget that shows it big.
 * Mirrors `toGameItem` on the server, which builds the saved ones. */
export function forWidget(game: GameItem): GameItem {
  return { ...game, imageUrl: game.coverImageId ? igdbCoverProxyUrl(game.coverImageId, 'cover_big') : null };
}
