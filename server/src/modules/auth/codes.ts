import crypto from 'node:crypto';
import { and, asc, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { authCodes } from '../../db/schema.js';
import { config } from '../../config/env.js';
import { normalizeEmail } from '../users/users.js';

/** `two_factor_setup` proves the account's email works before two-step login is turned on; `login`
 * is the second step of a login (tied to its challenge, see `challengeHash`). With two-step login on, the
 * account's current email is the second factor of everything that could take it away: `account_deletion`,
 * `two_factor_disable`, `login_alert_disable` and `email_change_current` (sent to the old address before
 * `email_change` goes to the new one). */
export type AuthCodePurpose =
  | 'password_reset' | 'email_change' | 'email_change_current' | 'two_factor_setup' | 'two_factor_disable'
  | 'login' | 'login_alert_disable' | 'account_deletion';

interface CodeScope {
  /** a login code belongs to one login challenge: another login neither cancels nor accepts it */
  challengeHash?: string;
}

export type VerifyCodeResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'invalid_code' | 'code_expired' | 'too_many_attempts' };

function hashCode(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}

function codeMatches(code: string, storedHash: string): boolean {
  const actual = Buffer.from(hashCode(code));
  const expected = Buffer.from(storedHash);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function scopeOf(scope: CodeScope) {
  return scope.challengeHash ? eq(authCodes.challengeHash, scope.challengeHash) : undefined;
}

export async function issueAuthCode(
  userId: string,
  purpose: AuthCodePurpose,
  email: string,
  { ttlMs = config.AUTH_CODE_TTL_MS, ...scope }: CodeScope & { ttlMs?: number } = {},
): Promise<string> {
  const normalizedEmail = normalizeEmail(email);
  const now = new Date();
  await db.update(authCodes)
    .set({ consumedAt: now })
    .where(and(eq(authCodes.userId, userId), eq(authCodes.purpose, purpose), isNull(authCodes.consumedAt), scopeOf(scope)));

  const code = String(crypto.randomInt(100000, 1000000));
  await db.insert(authCodes).values({
    id: crypto.randomUUID(),
    userId,
    purpose,
    email: normalizedEmail,
    codeHash: hashCode(code),
    challengeHash: scope.challengeHash ?? null,
    expiresAt: new Date(Date.now() + ttlMs),
  });
  return code;
}

export async function verifyAuthCode(
  userId: string,
  purpose: AuthCodePurpose,
  email: string,
  code: string,
  scope: CodeScope = {},
): Promise<VerifyCodeResult> {
  const normalizedEmail = normalizeEmail(email);
  const [record] = await db.select().from(authCodes)
    .where(and(
      eq(authCodes.userId, userId),
      eq(authCodes.purpose, purpose),
      eq(authCodes.email, normalizedEmail),
      isNull(authCodes.consumedAt),
      scopeOf(scope),
    ))
    .orderBy(desc(authCodes.createdAt))
    .limit(1);

  if (!record) return { ok: false, reason: 'invalid_code' };
  if (record.expiresAt.getTime() <= Date.now()) {
    await consumeCode(record.id);
    return { ok: false, reason: 'code_expired' };
  }

  // The attempt is claimed and capped in one statement: Postgres re-checks the WHERE after waiting on
  // the row lock, so parallel guesses cannot all read the same `attempts` and slip past the ceiling.
  const [claimed] = await db.update(authCodes)
    .set({ attempts: sql`${authCodes.attempts} + 1` })
    .where(and(eq(authCodes.id, record.id), isNull(authCodes.consumedAt), lt(authCodes.attempts, config.AUTH_CODE_MAX_ATTEMPTS)))
    .returning({ attempts: authCodes.attempts });
  if (!claimed) {
    // lost to a concurrent request that spent the last attempt or consumed the code
    await consumeCode(record.id);
    const [current] = await db.select({ attempts: authCodes.attempts }).from(authCodes).where(eq(authCodes.id, record.id));
    const exhausted = !current || current.attempts >= config.AUTH_CODE_MAX_ATTEMPTS;
    return { ok: false, reason: exhausted ? 'too_many_attempts' : 'invalid_code' };
  }

  if (!codeMatches(code, record.codeHash)) {
    if (claimed.attempts >= config.AUTH_CODE_MAX_ATTEMPTS) {
      await consumeCode(record.id);
      return { ok: false, reason: 'too_many_attempts' };
    }
    return { ok: false, reason: 'invalid_code' };
  }

  // Only the request that flips consumed_at wins, so one correct code cannot open two sessions.
  return (await consumeCode(record.id))
    ? { ok: true, id: record.id }
    : { ok: false, reason: 'invalid_code' };
}

/** Whether an unused, unexpired code of this purpose was sent to `email`. */
export async function hasLiveAuthCode(userId: string, purpose: AuthCodePurpose, email: string): Promise<boolean> {
  const [row] = await db.select({ id: authCodes.id }).from(authCodes)
    .where(and(
      eq(authCodes.userId, userId), eq(authCodes.purpose, purpose), eq(authCodes.email, normalizeEmail(email)),
      isNull(authCodes.consumedAt), gt(authCodes.expiresAt, new Date()),
    ))
    .limit(1);
  return Boolean(row);
}

/** True only for the caller that actually consumed the code. */
async function consumeCode(id: string): Promise<boolean> {
  const rows = await db.update(authCodes).set({ consumedAt: new Date() })
    .where(and(eq(authCodes.id, id), isNull(authCodes.consumedAt)))
    .returning({ id: authCodes.id });
  return rows.length > 0;
}

/** The account a login challenge was issued for and when it began (its first code), or null for a
 * challenge that was never issued. Whether a code is still usable is verifyAuthCode's call. */
export async function findLoginChallenge(challengeHash: string): Promise<{ userId: string; startedAt: Date } | null> {
  const [row] = await db.select({ userId: authCodes.userId, startedAt: authCodes.createdAt }).from(authCodes)
    .where(and(eq(authCodes.purpose, 'login'), eq(authCodes.challengeHash, challengeHash)))
    .orderBy(asc(authCodes.createdAt))
    .limit(1);
  return row ?? null;
}

/** Ends a login challenge, so neither of its codes nor a resend can be used again. */
export async function consumeLoginChallenge(challengeHash: string): Promise<void> {
  await db.update(authCodes).set({ consumedAt: new Date() })
    .where(and(eq(authCodes.purpose, 'login'), eq(authCodes.challengeHash, challengeHash), isNull(authCodes.consumedAt)));
}
