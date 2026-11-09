import crypto from 'node:crypto';
import { and, eq, gte, lt } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { knownLogins, type User } from '../../db/schema.js';
import { logger } from '../../lib/logger.js';
import { resolveLocale } from '../users/locale.js';
import { describeUserAgent } from './describeUserAgent.js';
import { isEmailDeliveryConfigured, sendLoginAlertEmail } from './email.js';
import * as ratelimit from './ratelimit.js';
import type { SessionOrigin } from './session.js';

const log = logger.child({ component: 'login-alert' });

// "Someone signed in from a browser this account has not used lately." A browser is its address plus what
// its user agent says it is (browser, system, phone or not): the full string changes with every browser
// update, which would make each re-login after one read as new. Seeing the same pair within
// KNOWN_LOGIN_DAYS keeps ordinary re-logins quiet. It lives in `known_logins` rather than in `sessions`
// because logging out deletes the session, and signing back in from the same browser must not read as new.

const DAY_MS = 24 * 60 * 60 * 1000;
export const KNOWN_LOGIN_DAYS = 30;
// A ceiling on alerts per account: whoever holds the password could otherwise sign in from endless new
// addresses and turn this into a mail cannon aimed at the owner.
const ALERT_RULE: ratelimit.Rule = { windowMs: 60 * 60 * 1000, max: 5 };

const sha256 = (text: string) => crypto.createHash('sha256').update(text).digest('hex');

/** Only the hash is stored, never the address. A user agent nothing is recognised in (a script, a tool) is
 * kept whole, so two different ones from the same address stay apart. */
function loginFingerprint(origin: SessionOrigin): string {
  const device = describeUserAgent(origin.userAgent);
  const kind = device.browser || device.os
    ? `${device.browser ?? ''}|${device.os ?? ''}|${device.mobile ? 'mobile' : 'desktop'}`
    : origin.userAgent;
  return sha256(`${origin.ip}\n${kind}`);
}

/** The formula of the backfill in migration 0063 (address plus the whole user agent), so the browsers that
 * held a session at the upgrade stay known. Those rows age out after KNOWN_LOGIN_DAYS; this can go then. */
function legacyLoginFingerprint(origin: SessionOrigin): string {
  return sha256(`${origin.ip}\n${origin.userAgent}`);
}

/** Notes this sign-in and returns whether its browser had not been seen in the last KNOWN_LOGIN_DAYS. */
export async function recordLogin(userId: string, origin: SessionOrigin, now = new Date()): Promise<boolean> {
  const fingerprint = loginFingerprint(origin);
  const cutoff = new Date(now.getTime() - KNOWN_LOGIN_DAYS * DAY_MS);
  const samePair = and(eq(knownLogins.userId, userId), eq(knownLogins.fingerprint, fingerprint));
  // One statement decides: a row comes back only when this sign-in created the pair or revived a stale one.
  // A concurrent sign-in of the same pair waits on the row and then re-checks `setWhere` against it, so two
  // simultaneous logins never both read as new (a select first would let both see nothing).
  const claimed = await db.insert(knownLogins).values({ userId, fingerprint, lastLoginAt: now })
    .onConflictDoUpdate({ target: [knownLogins.userId, knownLogins.fingerprint], set: { lastLoginAt: now }, setWhere: lt(knownLogins.lastLoginAt, cutoff) })
    .returning({ userId: knownLogins.userId });
  if (claimed.length === 0) {
    await db.update(knownLogins).set({ lastLoginAt: now }).where(and(samePair, lt(knownLogins.lastLoginAt, now)));
    return false;
  }
  const [legacy] = await db.select({ lastLoginAt: knownLogins.lastLoginAt }).from(knownLogins)
    .where(and(eq(knownLogins.userId, userId), eq(knownLogins.fingerprint, legacyLoginFingerprint(origin)), gte(knownLogins.lastLoginAt, cutoff)))
    .limit(1);
  return !legacy;
}

/** Called after a password or two-step login created a session (never for registration, which only
 * records the browser). Runs in the background: nothing here may fail or slow the login, so every error
 * is only logged. */
export function noticeLogin(user: User, origin: SessionOrigin): void {
  track(alertIfNewBrowser(user, origin).catch((err) => log.warn('login alert failed', { userId: user.id, err })));
}

// Alerts still on their way, so a test can wait for them instead of sleeping.
const inFlight = new Set<Promise<unknown>>();
function track(work: Promise<unknown>): void {
  inFlight.add(work);
  void work.finally(() => inFlight.delete(work));
}

/** Resolves once every alert started so far has been sent or has failed. */
export async function whenLoginAlertsSettled(): Promise<void> {
  while (inFlight.size > 0) await Promise.allSettled([...inFlight]);
}

async function alertIfNewBrowser(user: User, origin: SessionOrigin): Promise<void> {
  const isNew = await recordLogin(user.id, origin);
  if (!isNew || !user.loginAlertEmail || !user.email || !isEmailDeliveryConfigured()) return;
  const verdict = await ratelimit.consume(`login-alert:${user.id}`, ALERT_RULE);
  if (!verdict.allowed) return;
  await sendLoginAlertEmail({
    to: user.email, username: user.username, locale: resolveLocale(user.locale), ip: origin.ip, userAgent: origin.userAgent, at: new Date(),
  });
}

/** Registration signs the browser in too; recording it keeps the first real login from there quiet. */
export function noticeRegistration(userId: string, origin: SessionOrigin): void {
  track(recordLogin(userId, origin).catch((err) => log.warn('could not record the first browser', { userId, err })));
}

/** Forgets browsers not seen within the window; they would read as new anyway. Called with the session sweep. */
export async function sweepKnownLogins(): Promise<void> {
  await db.delete(knownLogins).where(lt(knownLogins.lastLoginAt, new Date(Date.now() - KNOWN_LOGIN_DAYS * DAY_MS)));
}
