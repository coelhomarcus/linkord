import { and, asc, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { activitySessions, users } from '../../db/schema.js';
import type { Activity } from '../presence/activity.js';
import { logger } from '../../lib/logger.js';

export const ACTIVITY_DAY_MS = 86_400_000;
export const ACTIVITY_CHECKPOINT_MS = 30_000;
export const ACTIVITY_RETENTION_DAYS = 400;

type Session = typeof activitySessions.$inferSelect;
export interface ActivitySessionStore {
  write(sessions: Session[]): Promise<void>;
}
export const databaseActivitySessionStore: ActivitySessionStore = {
  async write(sessions) {
    await db.insert(activitySessions).values(sessions).onConflictDoUpdate({
      target: activitySessions.id,
      set: {
        lastSeenAt: sql`excluded.last_seen_at`, endedAt: sql`excluded.ended_at`,
        kind: sql`excluded.kind`, name: sql`excluded.name`, icon: sql`coalesce(excluded.icon, ${activitySessions.icon})`,
      },
      setWhere: and(isNull(activitySessions.endedAt), sql`${activitySessions.lastSeenAt} <= excluded.last_seen_at`),
    });
  },
};

const log = logger.child({ component: 'activity-sessions' });

/** One session per account's visible activity, starting when this process sees it. Reported
 * start times are for the live timer and may include time outside a visible session. */
export function createActivitySessionTracker(store: ActivitySessionStore, now = () => new Date()) {
  const active = new Map<string, Session>();
  let writes = Promise.resolve();

  function write(rows: Session[]) {
    if (!rows.length) return;
    writes = writes.then(() => store.write(rows))
      .catch((err) => log.error('failed to write activity sessions', err));
  }

  return {
    observe(userId: string, activity: Activity | undefined) {
      const current = active.get(userId);
      const at = new Date(Math.max(now().getTime(), current?.lastSeenAt.getTime() ?? 0));
      if (current && activity?.key === current.key) {
        if (activity.kind !== current.kind || activity.name !== current.name || (activity.icon && activity.icon !== current.icon)) {
          const next = { ...current, kind: activity.kind, name: activity.name, icon: activity.icon ?? current.icon, lastSeenAt: at };
          active.set(userId, next);
          write([next]);
        }
        return;
      }

      const changed: Session[] = [];
      if (current) {
        changed.push({ ...current, lastSeenAt: at, endedAt: at });
        active.delete(userId);
      }
      if (activity) {
        const { key, kind, name, icon } = activity;
        const next = { id: crypto.randomUUID(), userId, key, kind, name, icon, startedAt: at, lastSeenAt: at, endedAt: null };
        active.set(userId, next);
        changed.push(next);
      }
      write(changed);
    },
    checkpoint() {
      const at = now();
      const rows: Session[] = [];
      for (const [userId, current] of active) {
        const next = { ...current, lastSeenAt: new Date(Math.max(at.getTime(), current.lastSeenAt.getTime())) };
        active.set(userId, next);
        rows.push(next);
        if (rows.length === 500) write(rows.splice(0));
      }
      write(rows);
    },
    written: () => writes,
  };
}

/** Open rows from the previous process stop at their last saved observation. */
export async function closeInterruptedActivitySessions(): Promise<void> {
  await db.update(activitySessions).set({ endedAt: activitySessions.lastSeenAt }).where(isNull(activitySessions.endedAt));
}

export async function pruneActivitySessions(now = Date.now()): Promise<void> {
  await db.delete(activitySessions).where(lt(activitySessions.lastSeenAt, new Date(now - ACTIVITY_RETENTION_DAYS * ACTIVITY_DAY_MS)));
}

/** Current account settings are applied in the same query as the session read. */
export async function readVisibleActivitySessions(userId: string, since: Date) {
  return db.select({
    key: activitySessions.key, kind: activitySessions.kind, name: activitySessions.name, icon: activitySessions.icon,
    startedAt: activitySessions.startedAt, lastSeenAt: activitySessions.lastSeenAt,
  }).from(activitySessions).innerJoin(users, eq(users.id, activitySessions.userId)).where(and(
    eq(activitySessions.userId, userId), eq(users.activitySharing, true), gt(activitySessions.lastSeenAt, since),
    sql`NOT (${users.hiddenActivities} ? ${activitySessions.key})`,
  )).orderBy(asc(activitySessions.lastSeenAt));
}

export async function exportActivitySessions(userId: string) {
  const rows = await db.select({
    key: activitySessions.key, kind: activitySessions.kind, name: activitySessions.name,
    startedAt: activitySessions.startedAt, lastSeenAt: activitySessions.lastSeenAt, endedAt: activitySessions.endedAt,
  }).from(activitySessions).where(eq(activitySessions.userId, userId)).orderBy(asc(activitySessions.startedAt));
  return rows;
}
