import crypto from 'node:crypto';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { profileGames } from '../../db/schema.js';
import { igdbGameUrl, isCoverImageId, isGameName, isGameSlug } from '../../integrations/igdb/igdb.js';
import { igdbCoverProxyUrl } from '../media-proxy/mediaProxyUrls.js';
import { GAME_LIST_LIMITS, GAME_LISTS, type GameItem, type GameList, type GameLists, type GameSnapshot } from './types.js';

/** A `db` or a transaction: callers choose whether the lists change together with something else. */
type Executor = Pick<typeof db, 'select' | 'insert' | 'delete'>;

export function toGameItem(game: GameSnapshot, size: 'cover_small' | 'cover_big' = 'cover_big'): GameItem {
  return { ...game, url: igdbGameUrl(game.slug), imageUrl: game.coverImageId ? igdbCoverProxyUrl(game.coverImageId, size) : null };
}

function parseGame(value: unknown): GameSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { igdbId, name, slug, coverImageId, releaseYear } = value as Record<string, unknown>;
  if (typeof igdbId !== 'number' || !Number.isSafeInteger(igdbId) || igdbId <= 0 || igdbId > 2_147_483_647) return null;
  if (!isGameName(name) || !isGameSlug(slug)) return null;
  if (coverImageId !== null && !isCoverImageId(coverImageId)) return null;
  if (releaseYear !== null && (typeof releaseYear !== 'number' || !Number.isInteger(releaseYear) || releaseYear < 1950 || releaseYear > 2200)) return null;
  return { igdbId, name, slug, coverImageId, releaseYear };
}

/** The lists a Wall save asks to replace; a list left out stays as it is. Null when anything is malformed,
 * over its limit or repeated: the picks come from the browser, but links and covers are only ever built here. */
export function parseGameLists(input: unknown): Partial<GameLists> | null {
  if (input === undefined) return {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const parsed: Partial<GameLists> = {};
  for (const [list, value] of Object.entries(input)) {
    if (!(GAME_LISTS as readonly string[]).includes(list) || !Array.isArray(value) || value.length > GAME_LIST_LIMITS[list as GameList]) return null;
    const games = value.map(parseGame);
    if (games.some((game) => !game) || new Set(games.map((game) => game!.igdbId)).size !== games.length) return null;
    parsed[list as GameList] = games as GameSnapshot[];
  }
  return parsed;
}

export async function replaceGameLists(executor: Executor, userId: string, lists: Partial<GameLists>): Promise<void> {
  const changed = Object.keys(lists) as GameList[];
  if (!changed.length) return;
  await executor.delete(profileGames).where(and(eq(profileGames.userId, userId), inArray(profileGames.list, changed)));
  const rows = changed.flatMap((list) => lists[list]!.map((game, position) => ({
    id: crypto.randomUUID(), userId, list, igdbId: game.igdbId, name: game.name, slug: game.slug,
    coverImageId: game.coverImageId, releaseYear: game.releaseYear, position,
  })));
  if (rows.length) await executor.insert(profileGames).values(rows);
}

export async function readGameLists(executor: Pick<typeof db, 'select'>, userId: string): Promise<Record<GameList, GameItem[]>> {
  const rows = await executor.select().from(profileGames).where(eq(profileGames.userId, userId)).orderBy(asc(profileGames.position), asc(profileGames.id));
  const lists: Record<GameList, GameItem[]> = { favorite: [], liked: [], playing: [], wishlist: [] };
  for (const row of rows) {
    lists[row.list].push(toGameItem({ igdbId: row.igdbId, name: row.name, slug: row.slug, coverImageId: row.coverImageId, releaseYear: row.releaseYear }));
  }
  return lists;
}
