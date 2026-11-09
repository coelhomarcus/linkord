import crypto from 'node:crypto';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { authCodes } from '../../db/schema.js';
import { config } from '../../config/env.js';
import { normalizeEmail } from '../users/users.js';

/** `two_factor_setup` proves the account's email works before two-step login is turned on; `login`
 * is the second step of a login (tied to its challenge, see `challengeHash`). */
export type AuthCodePurpose = 'password_reset' | 'email_change' | 'two_factor_setup' | 'login';

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
    await db.update(authCodes).set({ consumedAt: new Date() }).where(eq(authCodes.id, record.id));
    return { ok: false, reason: 'code_expired' };
  }
  if (record.attempts >= config.AUTH_CODE_MAX_ATTEMPTS) {
    await db.update(authCodes).set({ consumedAt: new Date() }).where(eq(authCodes.id, record.id));
    return { ok: false, reason: 'too_many_attempts' };
  }

  await db.update(authCodes).set({ attempts: record.attempts + 1 }).where(eq(authCodes.id, record.id));
  if (!codeMatches(code, record.codeHash)) {
    if (record.attempts + 1 >= config.AUTH_CODE_MAX_ATTEMPTS) {
      await db.update(authCodes).set({ consumedAt: new Date() }).where(eq(authCodes.id, record.id));
      return { ok: false, reason: 'too_many_attempts' };
    }
    return { ok: false, reason: 'invalid_code' };
  }

  await db.update(authCodes).set({ consumedAt: new Date() }).where(eq(authCodes.id, record.id));
  return { ok: true, id: record.id };
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
