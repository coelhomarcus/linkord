import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { users } from '../../db/schema.js';
import { ACTIVITY_DAY_MS as DAY, readVisibleActivitySessions } from './activitySessions.js';
import { readActivityHistory } from './activityHistory.js';
import { withSharedIcons } from './sharedGameIcons.js';
import type { ActivityPeriod, ActivityWidgetType, WidgetData } from '../connections/types.js';

type Session = Awaited<ReturnType<typeof readVisibleActivitySessions>>[number];
const CALENDAR_DAYS = 365;
const TOP_LIMIT = 8;

export function aggregateActivity(sessions: Session[], start: number, end: number) {
  const days = new Map<number, number>();
  const byKey = new Map<string, Pick<Session, 'key' | 'kind' | 'name' | 'icon'> & { milliseconds: number }>();
  let total = 0;
  for (const { startedAt, lastSeenAt, key, kind, name, icon } of sessions) {
    const from = Math.max(start, startedAt.getTime());
    const to = Math.min(end, lastSeenAt.getTime());
    if (from >= to) continue;
    const previous = byKey.get(key);
    byKey.set(key, { key, kind, name, icon: icon ?? previous?.icon ?? null, milliseconds: to - from + (previous?.milliseconds ?? 0) });
    total += to - from;
    for (let cursor = from; cursor < to;) {
      const day = Math.floor(cursor / DAY) * DAY;
      const until = Math.min(to, day + DAY);
      days.set(day, (days.get(day) ?? 0) + until - cursor);
      cursor = until;
    }
  }

  const ranked = [...byKey.values()].sort((a, b) => b.milliseconds - a.milliseconds || a.key.localeCompare(b.key));
  let longestStreak = 0;
  let streak = 0;
  let lastDay = -Infinity;
  for (const day of [...days.keys()].sort((a, b) => a - b)) {
    streak = day === lastDay + DAY ? streak + 1 : 1;
    longestStreak = Math.max(longestStreak, streak);
    lastDay = day;
  }
  return { days, total, ranked, longestStreak };
}

const level = (ms: number) => ms === 0 ? 0 : ms < 30 * 60_000 ? 1 : ms < 60 * 60_000 ? 2 : ms < 3 * 60 * 60_000 ? 3 : 4;

export async function readActivityWidgets(userId: string, wanted: Set<ActivityWidgetType>, now = Date.now()) {
  const [owner] = await db.select({ sharing: users.activitySharing }).from(users).where(eq(users.id, userId));
  if (!owner?.sharing) return null;
  const calendarStart = (Math.floor(now / DAY) - CALENDAR_DAYS + 1) * DAY;
  const since = wanted.has('activity-calendar') ? calendarStart : now - 30 * DAY;
  const [sessions, history] = await Promise.all([
    [...wanted].some((type) => type !== 'activity-recent') ? readVisibleActivitySessions(userId, new Date(since)) : [],
    wanted.has('activity-recent') ? readActivityHistory(userId, TOP_LIMIT) : null,
  ]);

  const widgets = new Map<ActivityWidgetType, WidgetData>();
  if (wanted.has('activity-recent')) widgets.set('activity-recent', { kind: 'activity-recent', items: history?.items ?? [] });
  if (wanted.has('activity-calendar')) {
    const { days, total } = aggregateActivity(sessions, calendarStart, now);
    widgets.set('activity-calendar', {
      kind: 'activity-calendar', total,
      days: days.size ? Array.from({ length: CALENDAR_DAYS }, (_, index) => {
        const date = calendarStart + index * DAY;
        const count = days.get(date) ?? 0;
        return { date: new Date(date).toISOString().slice(0, 10), count, level: level(count) };
      }) : [],
    });
  }
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
