import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { activityGameIcons } from '../../db/schema.js';
import { ConnectionFetchError } from '../../integrations/connectionHttp.js';
import type { GridIcon, SteamGridDbClient } from '../../integrations/steamgriddb/steamgriddb.js';
import { allow } from '../../realtime/floodControl.js';
import { pickByName, type ActivityGameQuery } from './activityGames.js';
import type { storeActivityIcon } from './activityIcons.js';

// The square icon a detected game shows with ("[icon] Jogando Fortnite"), from SteamGridDB. The picture
// is fetched once by the server and stored like a program's own icon (activityIcons.ts), so viewers
// load it from us and SteamGridDB never sees them. Every answer is kept in the database, as the IGDB
// name is (activityGames.ts): SteamGridDB is asked once per game, not once per person.

const FOUND_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// a game without an icon may get one later, and a failure is retried sooner still
const MISSING_TTL_MS = 24 * 60 * 60 * 1000;
const USER_RULE = { windowMs: 60_000, max: 20 };
// a picture that cannot be read is skipped for the next one, up to this many
const TRIED_ICONS = 3;

export interface ActivityGameIconRow {
  /** the stored icon's id (activityIcons.ts), or null when the game has none */
  iconId: string | null;
  resolvedAt: number;
}

export interface ActivityGameIconStore {
  get(key: string): Promise<ActivityGameIconRow | null>;
  set(key: string, iconId: string | null, resolvedAt: number): Promise<void>;
}

const databaseIconStore: ActivityGameIconStore = {
  async get(key) {
    const [row] = await db.select().from(activityGameIcons).where(eq(activityGameIcons.key, key)).limit(1);
    return row ? { iconId: row.iconId, resolvedAt: row.resolvedAt.getTime() } : null;
  },
  async set(key, iconId, resolvedAt) {
    const values = { key, iconId, resolvedAt: new Date(resolvedAt) };
    await db.insert(activityGameIcons).values(values).onConflictDoUpdate({ target: activityGameIcons.key, set: values });
  },
};

/** The game's official icon when there is one, else the best scored (SteamGridDB sorts by score). */
export function rankIcons(icons: GridIcon[]): GridIcon[] {
  return [...icons.filter((icon) => icon.style === 'official'), ...icons.filter((icon) => icon.style !== 'official')];
}

export function createActivityGameIconLookup(deps: {
  client: SteamGridDbClient;
  /** the bytes of a picture on SteamGridDB's image host */
  download: (url: string) => Promise<Buffer>;
  storeIcon: typeof storeActivityIcon;
  store?: ActivityGameIconStore;
  now?: () => number;
}) {
  const { client, download, storeIcon, store = databaseIconStore, now = Date.now } = deps;
  const inFlight = new Map<string, Promise<string | null>>();

  async function icons(steamAppId: number | null, name: string): Promise<GridIcon[]> {
    if (steamAppId) {
      const found = await client.steamIcons(steamAppId);
      if (found.length > 0) return found;
    }
    if (!name) return [];
    const game = pickByName(await client.searchGames(name), name);
    return game ? client.gameIcons(game.id) : [];
  }

  async function save(icon: GridIcon): Promise<string | null> {
    // the thumb first: always a PNG and big enough, where the full picture may be an .ico or 1024 px
    for (const url of icon.thumb ? [icon.thumb, icon.url] : [icon.url]) {
      const bytes = await download(url).catch(() => null);
      const stored = bytes ? await storeIcon(bytes) : null;
      if (stored && typeof stored === 'object') return stored.id;
    }
    return null;
  }

  async function resolve(query: ActivityGameQuery): Promise<string | null> {
    let iconId: string | null = null;
    try {
      for (const icon of rankIcons(await icons(query.steamAppId, query.name)).slice(0, TRIED_ICONS)) {
        iconId = await save(icon);
        if (iconId) break;
      }
    } catch (error) {
      // SteamGridDB failed or refused: shown without its icon this time, and not remembered
      if (!(error instanceof ConnectionFetchError)) console.error('[activity] game icon lookup failed', error);
      return null;
    }
    await store.set(query.key, iconId, now() - (iconId ? 0 : FOUND_TTL_MS - MISSING_TTL_MS))
      .catch((error: unknown) => console.error('[activity] could not remember a game icon', error));
    return iconId;
  }

  /** The stored icon id of a game, from the database when known, else from SteamGridDB; null for none.
   * Never throws: the icon is an extra, and the name answers without it. */
  return async function lookupIcon(userId: string, query: ActivityGameQuery): Promise<string | null> {
    const cached = await store.get(query.key).catch(() => null);
    if (cached && cached.resolvedAt + FOUND_TTL_MS > now()) return cached.iconId;
    if (!client.configured) return cached?.iconId ?? null;
    const pending = inFlight.get(query.key);
    if (pending) return pending;
    if (!allow(`activity-game-icon:${userId}`, USER_RULE)) return cached?.iconId ?? null;
    const request = resolve(query).finally(() => inFlight.delete(query.key));
    inFlight.set(query.key, request);
    return request;
  };
}
