// What each account played or used lately: the profile's "Atividade recente". One row per game or
// app (`activity_history`), with the last time others could see it.
//
// presence/presenceStatus.ts writes it when an activity others see starts or ends, through the
// store it is given (so the presence tests run without a database); this file reads it for the
// profile route, under the account's activity settings as they are now.

import { and, desc, eq, notInArray, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { activityHistory, users } from '../../db/schema.js';
import { isActivityKey, type Activity } from '../presence/activity.js';

/** How many games and apps an account's history keeps; older ones are dropped as new ones come. */
export const ACTIVITY_HISTORY_MAX = 20;

export interface ActivityHistoryItem {
  key: string;
  kind: Activity['kind'];
  name: string;
  icon: string | null;
  /** ISO time the account was last seen with it */
  lastPlayedAt: string;
}

export interface ActivityHistoryStore {
  /** The account was seen with `activity` at `at` (it started, changed or ended). */
  record(userId: string, activity: Activity, at: Date): Promise<void>;
}

export const databaseActivityHistoryStore: ActivityHistoryStore = {
  async record(userId, activity, at) {
    await db.transaction(async (tx) => {
      await tx.insert(activityHistory)
        .values({ userId, key: activity.key, kind: activity.kind, name: activity.name, icon: activity.icon, lastPlayedAt: at })
        .onConflictDoUpdate({
          target: [activityHistory.userId, activityHistory.key],
          // an icon found after the start is kept, and a later one wins; one that went away keeps the older
          set: { kind: activity.kind, name: activity.name, icon: sql`coalesce(excluded.icon, ${activityHistory.icon})`, lastPlayedAt: at },
        });
      const kept = tx.select({ key: activityHistory.key }).from(activityHistory)
        .where(eq(activityHistory.userId, userId))
        .orderBy(desc(activityHistory.lastPlayedAt))
        .limit(ACTIVITY_HISTORY_MAX);
      await tx.delete(activityHistory).where(and(eq(activityHistory.userId, userId), notInArray(activityHistory.key, kept)));
    });
  },
};

/** What the profile shows: nothing while the account does not share its activity, and never a game or
 * app it hides now, even one played before it was hidden. `null` when the account does not exist. */
export async function readActivityHistory(userId: string, limit = ACTIVITY_HISTORY_MAX): Promise<{ sharing: boolean; items: ActivityHistoryItem[] } | null> {
  const [settings] = await db.select({ sharing: users.activitySharing, hidden: users.hiddenActivities }).from(users).where(eq(users.id, userId)).limit(1);
  if (!settings) return null;
  if (!settings.sharing) return { sharing: false, items: [] };
  const hidden = new Set(Array.isArray(settings.hidden) ? settings.hidden : []);
  const rows = await db.select().from(activityHistory)
    .where(eq(activityHistory.userId, userId))
    .orderBy(desc(activityHistory.lastPlayedAt))
    .limit(ACTIVITY_HISTORY_MAX);
  const items = rows
    .filter((row) => !hidden.has(row.key) && isActivityKey(row.key) && (row.kind === 'playing' || row.kind === 'using'))
    .slice(0, limit)
    .map((row) => ({ key: row.key, kind: row.kind as Activity['kind'], name: row.name, icon: row.icon, lastPlayedAt: row.lastPlayedAt.toISOString() }));
  return { sharing: true, items };
}

/** Everything kept for the account, for its data export. */
export async function exportActivityHistory(userId: string): Promise<ActivityHistoryItem[]> {
  const rows = await db.select().from(activityHistory).where(eq(activityHistory.userId, userId)).orderBy(desc(activityHistory.lastPlayedAt));
  return rows.map((row) => ({ key: row.key, kind: row.kind as Activity['kind'], name: row.name, icon: row.icon, lastPlayedAt: row.lastPlayedAt.toISOString() }));
}
