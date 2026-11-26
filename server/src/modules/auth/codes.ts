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
    await db.update(authCodes).set({ consumedAt: new Date() })
      .where(and(eq(authCodes.id, record.id), isNull(authCodes.consumedAt)));
    return { ok: false, reason: 'code_expired' };
  }

  const matches = codeMatches(code, record.codeHash);
  // Postgres rechecks the guard after a concurrent update. Consume a match or the final
  // attempt in that same update so another request cannot spend an attempt in between.
  const [claimed] = await db.update(authCodes)
    .set({
      attempts: sql`${authCodes.attempts} + 1`,
      consumedAt: sql`case when ${matches} or ${authCodes.attempts} + 1 >= ${config.AUTH_CODE_MAX_ATTEMPTS} then now() end`,
    })
    .where(and(eq(authCodes.id, record.id), isNull(authCodes.consumedAt), lt(authCodes.attempts, config.AUTH_CODE_MAX_ATTEMPTS)))
    .returning({ attempts: authCodes.attempts });
  if (!claimed) {
    // lost to a concurrent request that spent the last attempt or consumed the code
    const [current] = await db.select({ attempts: authCodes.attempts }).from(authCodes).where(eq(authCodes.id, record.id));
    const exhausted = !current || current.attempts >= config.AUTH_CODE_MAX_ATTEMPTS;
    return { ok: false, reason: exhausted ? 'too_many_attempts' : 'invalid_code' };
  }

  if (matches) return { ok: true, id: record.id };
  return { ok: false, reason: claimed.attempts >= config.AUTH_CODE_MAX_ATTEMPTS ? 'too_many_attempts' : 'invalid_code' };
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
