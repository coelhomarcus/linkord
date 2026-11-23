import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { users } from '../../db/schema.js';
import { ACTIVITY_DAY_MS as DAY, readVisibleActivitySessions } from './activitySessions.js';
import { readActivityHistory } from './activityHistory.js';
import { withSharedIcons } from './sharedGameIcons.js';
import type { ActivityPeriod, ActivityWidgetType, WidgetData } from '../connections/types.js';

type Session = Awaited<ReturnType<typeof readVisibleActivitySessions>>[number];
const TOP_LIMIT = 8;

export function aggregateActivity(sessions: Session[], start: number, end: number) {
  const days = new Set<number>();
  const byKey = new Map<string, Pick<Session, 'key' | 'kind' | 'name' | 'icon'> & { milliseconds: number }>();
  let total = 0;
  for (const { startedAt, lastSeenAt, key, kind, name, icon } of sessions) {
    const from = Math.max(start, startedAt.getTime());
    const to = Math.min(end, lastSeenAt.getTime());
    if (from >= to) continue;
    const previous = byKey.get(key);
    byKey.set(key, { key, kind, name, icon: icon ?? previous?.icon ?? null, milliseconds: to - from + (previous?.milliseconds ?? 0) });
    total += to - from;
    for (let day = Math.floor(from / DAY) * DAY; day < to; day += DAY) days.add(day);
  }

  const ranked = [...byKey.values()].sort((a, b) => b.milliseconds - a.milliseconds || a.key.localeCompare(b.key));
  let longestStreak = 0;
  let streak = 0;
  let lastDay = -Infinity;
  for (const day of [...days].sort((a, b) => a - b)) {
    streak = day === lastDay + DAY ? streak + 1 : 1;
    longestStreak = Math.max(longestStreak, streak);
    lastDay = day;
  }
  return { total, ranked, longestStreak };
}

export async function readActivityWidgets(userId: string, wanted: Set<ActivityWidgetType>, now = Date.now()) {
  const [owner] = await db.select({ sharing: users.activitySharing }).from(users).where(eq(users.id, userId));
  if (!owner?.sharing) return null;
  const [sessions, history] = await Promise.all([
    wanted.has('activity-top') || wanted.has('activity-summary') ? readVisibleActivitySessions(userId, new Date(now - 30 * DAY)) : [],
    wanted.has('activity-recent') ? readActivityHistory(userId, TOP_LIMIT) : null,
  ]);

  const widgets = new Map<ActivityWidgetType, WidgetData>();
  if (wanted.has('activity-recent')) widgets.set('activity-recent', { kind: 'activity-recent', items: history?.items ?? [] });
  const byPeriod = new Map<ActivityPeriod, { top: WidgetData; summary: WidgetData }>();
  if (wanted.has('activity-top') || wanted.has('activity-summary')) {
    for (const period of [7, 30] as const) {
      const { ranked, total, longestStreak } = aggregateActivity(sessions, now - period * DAY, now);
      const items = wanted.has('activity-top') ? await withSharedIcons(ranked.slice(0, TOP_LIMIT)) : [];
      byPeriod.set(period, { top: { kind: 'activity-top', items }, summary: {
        kind: 'activity-summary', total, longestStreak, favorite: ranked.find((item) => item.kind === 'playing')?.name ?? null,
      } });
    }
  }
  return {
    widget(type: ActivityWidgetType, period: ActivityPeriod): WidgetData | null {
      if (type === 'activity-top') return byPeriod.get(period)?.top ?? null;
      if (type === 'activity-summary') return byPeriod.get(period)?.summary ?? null;
      return widgets.get(type) ?? null;
    },
  };
}
