import { between, lt, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { adminCallPeaks } from '../../db/schema.js';
import { logger } from '../../lib/logger.js';
import { CALL_ROOM_SWEEP_MS } from '../calls/callRoomSync.js';
import { answeredDmConversationIds } from '../calls/dmCalls.js';
import { participants } from '../presence/participants.js';

const log = logger.child({ component: 'admin-call-metrics' });
const TIME_ZONE = 'America/Belem';
const HISTORY_DAYS = 7;
const DAY_MS = 86_400_000;
const calendar = new Intl.DateTimeFormat('en', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

type Peak = typeof adminCallPeaks.$inferInsert;

const pendingPeaks = new Map<string, Peak>();
let writing: Promise<void> | null = null;
let prunedForDay: string | null = null;
let lastScreens: { count: number; at: Date } | null = null;
let screenReadFailed = false;

function metricsDayStart(now: Date): number {
  const parts = Object.fromEntries(calendar.formatToParts(now).map(({ type, value }) => [type, value]));
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
}

function dayLabel(utc: number): string {
  return new Date(utc).toISOString().slice(0, 10);
}

export function adminMetricsDays(now: Date): string[] {
  const today = metricsDayStart(now);
  return Array.from({ length: HISTORY_DAYS }, (_, index) =>
    dayLabel(today - (HISTORY_DAYS - 1 - index) * DAY_MS));
}

function callCounts() {
  const calls = new Set(answeredDmConversationIds());
  const accountsInCall = new Set<string>();
  const onlineAccounts = new Set<string>();
  for (const participant of participants.values()) {
    if (participant.socket) onlineAccounts.add(participant.userId);
    if (participant.callConversationId) {
      calls.add(participant.callConversationId);
      accountsInCall.add(participant.userId);
    }
  }
  return { calls: calls.size, accountsInCall: accountsInCall.size, onlineAccounts: onlineAccounts.size };
}

function rememberPeak(metric: Peak['metric'], peak: number, day: string) {
  const key = `${day}/${metric}`;
  const pending = pendingPeaks.get(key);
  if (!pending || pending.peak < peak) pendingPeaks.set(key, { day, metric, peak });
}

export function observeAdminScreens(count: number | null) {
  screenReadFailed = count === null;
  if (count === null) return;
  const at = new Date();
  lastScreens = { count, at };
  rememberPeak('screens', count, dayLabel(metricsDayStart(at)));
}

async function writePeaks(oldest: string, today: string) {
  for (const [key, row] of pendingPeaks) {
    if (row.day < oldest) pendingPeaks.delete(key);
  }
  const batch = [...pendingPeaks];
  if (batch.length > 0) {
    const incoming = sql`excluded.peak`;
    await db.insert(adminCallPeaks).values(batch.map(([, row]) => row)).onConflictDoUpdate({
      target: [adminCallPeaks.day, adminCallPeaks.metric],
      set: { peak: incoming },
      setWhere: lt(adminCallPeaks.peak, incoming),
    });
    for (const [key, row] of batch) {
      if (pendingPeaks.get(key) === row) pendingPeaks.delete(key);
    }
  }
  if (prunedForDay !== today) {
    await db.delete(adminCallPeaks).where(lt(adminCallPeaks.day, oldest));
    prunedForDay = today;
  }
}

function checkpoint(now = new Date()) {
  const days = adminMetricsDays(now);
  const today = days.at(-1)!;
  rememberPeak('calls', callCounts().calls, today);
  if (writing) return;
  writing = writePeaks(days[0]!, today)
    .catch((err) => log.error('failed to save admin call peaks', err))
    .finally(() => { writing = null; });
}

export function startAdminCallMetrics() {
  checkpoint();
  return setInterval(checkpoint, CALL_ROOM_SWEEP_MS).unref();
}

export async function flushAdminCallPeaks() {
  await writing;
  if (pendingPeaks.size === 0) return;
  const days = adminMetricsDays(new Date());
  await writePeaks(days[0]!, days.at(-1)!).catch((err) => log.error('failed to flush admin call peaks', err));
}

export async function getAdminCallMetrics(now = new Date()) {
  const counts = callCounts();
  const days = adminMetricsDays(now);
  const screens = lastScreens && {
    count: lastScreens.count,
    at: lastScreens.at.toISOString(),
    stale: screenReadFailed || now.getTime() - lastScreens.at.getTime() >= 2 * CALL_ROOM_SWEEP_MS,
  };
  const peaks = await db.select().from(adminCallPeaks).where(between(adminCallPeaks.day, days[0]!, days.at(-1)!));
  return {
    current: { ...counts, at: now.toISOString(), screens },
    timeZone: TIME_ZONE,
    history: days.map((day) => ({
      day,
      calls: peaks.find((row) => row.day === day && row.metric === 'calls')?.peak ?? null,
      screens: peaks.find((row) => row.day === day && row.metric === 'screens')?.peak ?? null,
    })),
  };
}
