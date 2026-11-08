import crypto from 'node:crypto';
import { lt, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { rateLimitWindows } from '../../db/schema.js';
import { logger } from '../../lib/logger.js';

// Attempt limits that guard against brute force: failed logins, recovery and email-change codes,
// the invite code and sign-ups per address. They live in Postgres so a restart or a deploy does not
// hand an attacker fresh attempts, and so several instances would share one count.
//
// Deliberately NOT here: realtime/floodControl.ts and the other per-minute quotas (socket messages,
// typing, link previews, searches). Those only cap short bursts of otherwise legitimate traffic, losing
// them on a restart costs nothing, and a database write per socket event would be the expensive part.
//
// The window is fixed (it starts at the first attempt and the row is reset in place once it ends),
// so a hit is a single atomic upsert and concurrent requests cannot both read "9 of 10".

export interface Rule {
  windowMs: number;
  max: number;
}

/** Failed logins and wrong invite codes: 10 mistakes block the key for the rest of the 15 minutes. */
export const FAILURE_RULE: Rule = { windowMs: 15 * 60 * 1000, max: 10 };

const log = logger.child({ component: 'ratelimit' });

/** Thrown when the database cannot answer. Callers turn it into a refusal (503): never into "allowed". */
export class RateLimitUnavailableError extends Error {
  constructor(cause: unknown) {
    super('The attempt counters are unavailable.', { cause });
  }
}

// Hashed so the table never holds an email, a username or an address, and so a key an attacker controls
// (a made-up username) has a fixed size.
const storedKey = (key: string): string => crypto.createHash('sha256').update(key).digest('hex');

async function guarded<T>(what: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    log.error(`attempt counters failed to ${what}`, err);
    throw new RateLimitUnavailableError(err);
  }
}

const rowsOf = (result: unknown): Record<string, unknown>[] => (result as { rows: Record<string, unknown>[] }).rows;

interface Hit {
  count: number;
  /** seconds until the window ends, at least 1 */
  retryAfterSec: number;
}

/** Counts one attempt against `key` in one statement. Past the ceiling the count keeps growing but the
 * window does not move, so hammering a blocked key never extends its block. */
async function hit(key: string, rule: Rule): Promise<Hit> {
  const k = storedKey(key);
  const windowSql = sql`(${rule.windowMs}::double precision * interval '1 millisecond')`;
  const t = rateLimitWindows;
  const expired = sql`${t.windowEndsAt} <= now()`;
  const nextCount = sql`(case when ${expired} then 1 else ${t.count} + 1 end)`;
  const nextEnd = sql`(case when ${expired} then now() + ${windowSql} else ${t.windowEndsAt} end)`;
  const result = await db.execute(sql`
    insert into rate_limit_windows (key, count, window_ends_at, blocked_until)
    values (${k}, 1, now() + ${windowSql}, case when 1 >= ${rule.max} then now() + ${windowSql} else null end)
    on conflict (key) do update set
      count = ${nextCount},
      window_ends_at = ${nextEnd},
      blocked_until = case when ${nextCount} >= ${rule.max} then ${nextEnd} else null end
    returning count, greatest(1, ceil(extract(epoch from (window_ends_at - now()))))::int as retry_after_sec
  `);
  const row = rowsOf(result)[0]!;
  return { count: Number(row.count), retryAfterSec: Number(row.retry_after_sec) };
}

/** null if allowed, otherwise the number of seconds until the next try. */
export async function checkBlocked(key: string): Promise<number | null> {
  return guarded('check a key', async () => {
    const result = await db.execute(sql`
      select greatest(1, ceil(extract(epoch from (blocked_until - now()))))::int as retry_after_sec
      from rate_limit_windows where key = ${storedKey(key)} and blocked_until > now()
    `);
    const row = rowsOf(result)[0];
    return row ? Number(row.retry_after_sec) : null;
  });
}

/** Records one failed attempt; `checkBlocked` starts answering once the rule's ceiling is reached. */
export async function recordFailure(key: string, rule: Rule = FAILURE_RULE): Promise<void> {
  await guarded('record a failure', () => hit(key, rule));
}

/** Counts one attempt and says whether it may go ahead, for limits on requests rather than on mistakes
 * (a code email sent, an account created). The attempt is counted even when refused. */
export async function consume(key: string, rule: Rule): Promise<{ allowed: true } | { allowed: false; retryAfterSec: number }> {
  const result = await guarded('count an attempt', () => hit(key, rule));
  return result.count <= rule.max ? { allowed: true } : { allowed: false, retryAfterSec: result.retryAfterSec };
}

export async function reset(key: string): Promise<void> {
  await guarded('reset a key', () => db.execute(sql`delete from rate_limit_windows where key = ${storedKey(key)}`));
}

/** Drops the rows whose window is over (they would be reset on their next hit anyway); called
 * periodically from app/bootstrap.ts so keys that never come back do not pile up. */
export async function sweepExpiredRateLimits(): Promise<number> {
  const rows = await db.delete(rateLimitWindows)
    .where(lt(rateLimitWindows.windowEndsAt, sql`now()`))
    .returning({ key: rateLimitWindows.key });
  return rows.length;
}
