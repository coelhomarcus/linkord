import { inArray } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { activityGameIcons } from '../../db/schema.js';
import { ActivityGameError, parseActivityGameQuery } from './activityGames.js';

// One icon per game or app, whoever played or used it. The page reports the icon it was given (or, when
// the lookup failed or an older build ran, the program's own), so two people with the same game could
// show two icons, and a profile kept the wrong one for good. The icon (activityGameIcons.ts) is stored
// once per game or app, so a report and every history row are shown with that one, whatever was sent;
// the reported icon only stands for one without.

export interface SharedIconSource {
  /** The stored icon id of each key that has one (`activity_game_icons`). */
  iconIds(gameKeys: string[]): Promise<Map<string, string>>;
}

export const databaseSharedIconSource: SharedIconSource = {
  async iconIds(gameKeys) {
    if (gameKeys.length === 0) return new Map();
    const rows = await db.select({ key: activityGameIcons.key, iconId: activityGameIcons.iconId })
      .from(activityGameIcons).where(inArray(activityGameIcons.key, gameKeys));
    return new Map(rows.flatMap((row) => (row.iconId ? [[row.key, row.iconId] as const] : [])));
  },
};

const STEAM_KEY = /^steam:(\d{1,10})$/;

function activityIconUrl(iconId: string): string {
  return `/api/activity/icons/${iconId}.webp`;
}

/** The key the icon is stored under (`GET /api/activity/game` asks by it): a Steam game by its app id,
 * any other game or an app by its name. */
export function sharedIconKey(activity: { key: string; kind: string; name: string }): string | null {
  if (activity.kind !== 'playing' && activity.kind !== 'using') return null;
  const steam = STEAM_KEY.exec(activity.key);
  try {
    return parseActivityGameQuery({ steamAppId: steam?.[1], name: activity.name, kind: activity.kind }).key;
  } catch (error) {
    if (error instanceof ActivityGameError) return null;
    throw error;
  }
}

/** The activities with their own shared icon where they have one. Never throws: when the icons cannot be
 * read, the reported ones are shown. */
export async function withSharedIcons<T extends { key: string; kind: string; name: string; icon: string | null }>(
  items: T[],
  source: SharedIconSource = databaseSharedIconSource,
): Promise<T[]> {
  const keys = items.map(sharedIconKey);
  const wanted = [...new Set(keys.filter((key): key is string => key !== null))];
  if (wanted.length === 0) return items;
  const found = await source.iconIds(wanted).catch((error: unknown) => {
    console.error('[activity] could not read the shared game icons', error);
    return new Map<string, string>();
  });
  return items.map((item, i) => {
    const iconId = keys[i] ? found.get(keys[i]) : undefined;
    const icon = iconId ? activityIconUrl(iconId) : item.icon;
    return icon === item.icon ? item : { ...item, icon };
  });
}
