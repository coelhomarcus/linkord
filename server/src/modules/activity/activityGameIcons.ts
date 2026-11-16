import fs from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { activityGameIcons } from '../../db/schema.js';
import { ConnectionFetchError } from '../../integrations/connectionHttp.js';
import { steamClientIconUrl, steamCommunityIconUrl } from '../../integrations/steam/steamAssets.js';
import type { GridGame, GridIcon, SteamGridDbClient } from '../../integrations/steamgriddb/steamgriddb.js';
import { allow } from '../../realtime/floodControl.js';
import type { ActivityGameQuery } from './activityGames.js';
import { activityIconPath, type storeActivityIcon } from './activityIcons.js';
import { largestIcoImage } from './icoImage.js';
import { iconDistance } from './iconMatch.js';

// The square icon a detected game shows with ("[icon] Jogando Fortnite"). SteamGridDB finds the game,
// and for a game on Steam the icon is Steam's own (the client's .ico, up to 256 px). When that is too
// small, the SteamGridDB icon that looks most like it is used, and Steam's small one when none does:
// SteamGridDB's icons are uploaded by anyone, and an upload marked "official" is often fan art. A game
// outside Steam is compared with the icon the desktop app read from the program itself, when the page
// sends it; with no reference, or nothing like it, it takes SteamGridDB's first "official" icon. The picture is fetched
// once by the server and stored like a program's own icon (activityIcons.ts), so viewers load it from
// us. Every answer is kept in the database, as the IGDB name is (activityGames.ts): it is worked out
// once per game, not once per person.

const FOUND_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// a game without an icon may get one later, and a failure is retried sooner still
const MISSING_TTL_MS = 24 * 60 * 60 * 1000;
const USER_RULE = { windowMs: 60_000, max: 20 };
// Steam's icon at this size or more is used as is; below it, it is only the reference
const STEAM_ICON_MIN_PX = 64;
// how many community icons are compared with the reference, and how far one may be (iconDistance) and
// still count as the same icon: measured on 28 Steam games, the real one lands under 0.19 and the
// fan art at 0.25 and beyond
const COMPARED_ICONS = 20;
const SAME_ICON_MAX_DISTANCE = 0.2;
// a picture that cannot be read is skipped for the next one, up to this many
const TRIED_ICONS = 3;

export interface ActivityGameIcon {
  /** the stored icon's id (activityIcons.ts), or null when the game has none */
  iconId: string | null;
  /** whether the icon was chosen against a reference (Steam's icon or the program's): an answer
   * without one is worked out again the first time someone sends a program icon */
  referenced: boolean;
}

export interface ActivityGameIconRow extends ActivityGameIcon {
  resolvedAt: number;
}

export interface ActivityGameIconStore {
  get(key: string): Promise<ActivityGameIconRow | null>;
  set(key: string, value: ActivityGameIcon, resolvedAt: number): Promise<void>;
}

async function readStoredIcon(iconId: string): Promise<Buffer | null> {
  return fs.readFile(activityIconPath(iconId)).catch(() => null);
}

const databaseIconStore: ActivityGameIconStore = {
  async get(key) {
    const [row] = await db.select().from(activityGameIcons).where(eq(activityGameIcons.key, key)).limit(1);
    return row ? { iconId: row.iconId, referenced: row.referenced, resolvedAt: row.resolvedAt.getTime() } : null;
  },
  async set(key, value, resolvedAt) {
    const values = { key, iconId: value.iconId, referenced: value.referenced, resolvedAt: new Date(resolvedAt) };
    await db.insert(activityGameIcons).values(values).onConflictDoUpdate({ target: activityGameIcons.key, set: values });
  },
};

/** The game's "official" icons first, then the others, each in SteamGridDB's order. */
export function rankIcons(icons: GridIcon[]): GridIcon[] {
  return [...icons.filter((icon) => icon.style === 'official'), ...icons.filter((icon) => icon.style !== 'official')];
}

const ROMAN: Record<string, string> = { ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10' };

/** A name as compared: no ™/®, no punctuation or case, and "III" read as "3". */
export function comparableName(name: string): string {
  // the marks go before NFKC, which would spell ™ out as "TM"
  return name.replace(/[™®©]/g, ' ').normalize('NFKC').toLowerCase().replace(/['’]/g, '').split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean).map((word) => ROMAN[word] ?? word).join(' ');
}

/** The game with exactly this name, the latest released when several share it (Call of Duty, Doom);
 * null when none has it: a near miss is another game ("Baldur's Gate 3 Toolkit"), not this one. */
export function pickGame(games: GridGame[], name: string): GridGame | null {
  const wanted = comparableName(name);
  const same = games.filter((game) => comparableName(game.name) === wanted);
  return same.sort((a, b) => (b.releaseDate ?? -1) - (a.releaseDate ?? -1))[0] ?? null;
}

export function createActivityGameIconLookup(deps: {
  client: SteamGridDbClient;
  /** the bytes of a picture on SteamGridDB's or Steam's image host */
  download: (url: string) => Promise<Buffer>;
  storeIcon: typeof storeActivityIcon;
  /** a stored icon's picture (the program's own, sent as the reference), or null */
  readIcon?: (iconId: string) => Promise<Buffer | null>;
  store?: ActivityGameIconStore;
  /** how alike two pictures look, 0 to 1 (iconMatch.ts) */
  distance?: (a: Buffer, b: Buffer) => Promise<number>;
  now?: () => number;
}) {
  const { client, download, storeIcon, readIcon = readStoredIcon, store = databaseIconStore, distance = iconDistance, now = Date.now } = deps;
  const inFlight = new Map<string, Promise<string | null>>();

  async function findGame(steamAppId: number | null, name: string): Promise<GridGame | null> {
    if (steamAppId) {
      const game = await client.steamGame(steamAppId);
      if (game) return game;
    }
    if (!name) return null;
    const found = pickGame(await client.searchGames(name), name);
    // a search does not say whether the game is on Steam
    return found ? (await client.gameById(found.id)) ?? found : null;
  }

  async function saved(bytes: Buffer | null): Promise<string | null> {
    const stored = bytes ? await storeIcon(bytes) : null;
    return stored && typeof stored === 'object' ? stored.id : null;
  }

  /** A community icon's picture: its PNG thumb first, always readable, where the full one may be an .ico. */
  async function picture(icon: GridIcon): Promise<Buffer | null> {
    for (const url of icon.thumb ? [icon.thumb, icon.url] : [icon.url]) {
      const bytes = await download(url).catch(() => null);
      if (bytes) return bytes;
    }
    return null;
  }

  /** Steam's own icon of the game: `best` when it is large enough to show, else only a `reference`. */
  async function steamIcon(game: GridGame): Promise<{ best: Buffer | null; reference: Buffer | null }> {
    const steam = game.steam;
    if (!steam) return { best: null, reference: null };
    const icoUrl = steam.clientIcon ? steamClientIconUrl(steam.appId, steam.clientIcon) : null;
    const ico = icoUrl ? await download(icoUrl).then(largestIcoImage).catch(() => null) : null;
    if (ico && ico.size >= STEAM_ICON_MIN_PX) return { best: ico.png, reference: ico.png };
    if (ico) return { best: null, reference: ico.png };
    const jpgUrl = steam.icon ? steamCommunityIconUrl(steam.appId, steam.icon) : null;
    return { best: null, reference: jpgUrl ? await download(jpgUrl).catch(() => null) : null };
  }

  /** The community icons that look like the reference, most alike first. */
  async function alike(icons: GridIcon[], reference: Buffer): Promise<Buffer[]> {
    const scored = await Promise.all(icons.slice(0, COMPARED_ICONS).map(async (icon) => {
      const bytes = await picture(icon);
      const d = bytes ? await distance(reference, bytes).catch(() => Infinity) : Infinity;
      return { bytes, d };
    }));
    return scored.filter((item) => item.bytes && item.d <= SAME_ICON_MAX_DISTANCE).sort((a, b) => a.d - b.d).map((item) => item.bytes!);
  }

  async function firstSaved(pictures: (Buffer | null)[]): Promise<string | null> {
    for (const bytes of pictures.slice(0, TRIED_ICONS)) {
      const id = await saved(bytes);
      if (id) return id;
    }
    return null;
  }

  async function iconFor(game: GridGame, programIcon: Buffer | null): Promise<ActivityGameIcon> {
    const steam = await steamIcon(game);
    const fromSteam = await saved(steam.best);
    if (fromSteam) return { iconId: fromSteam, referenced: true };
    const icons = await client.gameIcons(game.id);
    if (steam.reference) {
      // nothing in the community's looks like the real one: the real one, small as it is
      const iconId = (await firstSaved(await alike(icons, steam.reference))) ?? (await saved(steam.reference));
      return { iconId, referenced: true };
    }
    if (programIcon) {
      // the program's own icon is not shown in its place: it may be a launcher's or an engine's
      const iconId = await firstSaved(await alike(icons, programIcon));
      if (iconId) return { iconId, referenced: true };
    }
    let iconId: string | null = null;
    // one at a time: the first readable one ends it, so the others are never downloaded
    for (const icon of rankIcons(icons).slice(0, TRIED_ICONS)) {
      iconId = await saved(await picture(icon));
      if (iconId) break;
    }
    return { iconId, referenced: programIcon !== null };
  }

  async function resolve(query: ActivityGameQuery, referenceId: string | null): Promise<string | null> {
    let value: ActivityGameIcon = { iconId: null, referenced: false };
    try {
      const game = await findGame(query.steamAppId, query.name);
      const programIcon = referenceId ? await readIcon(referenceId).catch(() => null) : null;
      if (game) value = await iconFor(game, programIcon);
    } catch (error) {
      // SteamGridDB failed or refused: shown without its icon this time, and not remembered
      if (!(error instanceof ConnectionFetchError)) console.error('[activity] game icon lookup failed', error);
      return null;
    }
    await store.set(query.key, value, now() - (value.iconId ? 0 : FOUND_TTL_MS - MISSING_TTL_MS))
      .catch((error: unknown) => console.error('[activity] could not remember a game icon', error));
    return value.iconId;
  }
  /** The stored icon id of a game, from the database when known, else from SteamGridDB; null for none.
   * Never throws: the icon is an extra, and the name answers without it. */
  return async function lookupIcon(userId: string, query: ActivityGameQuery, referenceId: string | null = null): Promise<string | null> {
    const cached = await store.get(query.key).catch(() => null);
    const fresh = cached && cached.resolvedAt + FOUND_TTL_MS > now();
    if (fresh && (cached.referenced || !referenceId)) return cached.iconId;
    if (!client.configured) return cached?.iconId ?? null;
    const pending = inFlight.get(query.key);
    if (pending) return pending;
    if (!allow(`activity-game-icon:${userId}`, USER_RULE)) return cached?.iconId ?? null;
    const request = resolve(query, referenceId).finally(() => inFlight.delete(query.key));
    inFlight.set(query.key, request);
    return request;
  };
}
