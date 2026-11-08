export const GAME_LISTS = ['favorite', 'liked', 'playing', 'wishlist'] as const;
export type GameList = (typeof GAME_LISTS)[number];

/** The Wall widget that shows each list. */
export const GAME_WIDGET_TYPES = {
  favorite: 'igdb-favorite-game',
  liked: 'igdb-liked-games',
  playing: 'igdb-playing-games',
  wishlist: 'igdb-wishlist-games',
} as const satisfies Record<GameList, string>;
export type GameWidgetType = (typeof GAME_WIDGET_TYPES)[GameList];

/** The list a widget type shows, or null for a type that is not a games widget. */
export function gameListOf(type: string): GameList | null {
  return GAME_LISTS.find((list) => GAME_WIDGET_TYPES[list] === type) ?? null;
}

// The lists of eight match the 4x2 grid of covers on the MyAnimeList widget.
export const GAME_LIST_LIMITS: Record<GameList, number> = { favorite: 1, liked: 8, playing: 8, wishlist: 8 };

/** What is kept of a game at the moment it is picked. Viewing a profile never asks IGDB again. */
export interface GameSnapshot {
  igdbId: number;
  name: string;
  slug: string;
  coverImageId: string | null;
  releaseYear: number | null;
}

/** A snapshot with the links built from it, as the client receives it. */
export interface GameItem extends GameSnapshot {
  url: string;
  imageUrl: string | null;
}

export type GameLists = Record<GameList, GameSnapshot[]>;
