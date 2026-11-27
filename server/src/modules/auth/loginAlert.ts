import crypto from 'node:crypto';
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { knownLogins, type User } from '../../db/schema.js';
import { logger } from '../../lib/logger.js';
import { resolveLocale } from '../users/locale.js';
import { describeUserAgent } from './describeUserAgent.js';
import { isEmailDeliveryConfigured, sendLoginAlertEmail } from './email.js';
import * as ratelimit from './ratelimit.js';
import type { SessionOrigin, SessionScope } from './session.js';

const log = logger.child({ component: 'login-alert' });

export const KNOWN_LOGIN_DAYS = 30;
export const KNOWN_LOGIN_SECONDS = KNOWN_LOGIN_DAYS * 24 * 60 * 60;
const knownLoginCutoff = (now: Date) => new Date(now.getTime() - KNOWN_LOGIN_SECONDS * 1000);
// A ceiling on alerts per account: whoever holds the password could otherwise sign in from endless new
// addresses and turn this into a mail cannon aimed at the owner.
const ALERT_RULE: ratelimit.Rule = { windowMs: 60 * 60 * 1000, max: 5 };

const sha256 = (text: string) => crypto.createHash('sha256').update(text).digest('hex');

/** Alert fallback for browsers without a remembered cookie. Use the browser family, system and mobile
 * flag so upgrades stay quiet. Keep the whole user agent if it does not identify a browser or system. */
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
  const cutoff = knownLoginCutoff(now);
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

function deviceFingerprint(scope: SessionScope, token?: string): string {
  const hash = token && /^[A-Za-z0-9_-]{43}$/.test(token) ? sha256(token) : '';
  // The prefix separates device tokens from the unprefixed hashes used for email alerts.
  return `device:${scope}:${hash}`;
}

function recentDevice(userId: string, scope: SessionScope, token: string | undefined, now: Date) {
  return and(
    eq(knownLogins.userId, userId),
    eq(knownLogins.fingerprint, deviceFingerprint(scope, token)),
    gte(knownLogins.lastLoginAt, knownLoginCutoff(now)),
  );
}

/** Per-account limits require a recent device token. Look up a key even for missing or malformed
 * cookies and accounts so those requests take the same path. The empty hash never matches a row. */
export async function isKnownBrowser(userId: string, scope: SessionScope, token: string | undefined, now = new Date()): Promise<boolean> {
  const [row] = await db.select({ userId: knownLogins.userId }).from(knownLogins)
    .where(recentDevice(userId, scope, token, now))
    .limit(1);
  return Boolean(row);
}

/** Refresh an already trusted device or issue a server-generated token after completed authentication.
 * A caller-supplied token can only be reused for the same account and site. */
export async function rememberBrowser(userId: string, scope: SessionScope, token: string | undefined, now = new Date()): Promise<{ token: string; known: boolean }> {
  if (token) {
    const [row] = await db.update(knownLogins).set({ lastLoginAt: sql`greatest(${knownLogins.lastLoginAt}, ${now.toISOString()})` })
      .where(recentDevice(userId, scope, token, now)).returning({ userId: knownLogins.userId });
    if (row) return { token, known: true };
  }

  const freshToken = crypto.randomBytes(32).toString('base64url');
  await db.insert(knownLogins).values({ userId, fingerprint: deviceFingerprint(scope, freshToken), lastLoginAt: now });
  return { token: freshToken, known: false };
}

/** Login alerts run in the background after a session was created. */
export function noticeLogin(user: User, origin: SessionOrigin, knownDevice: boolean): void {
  track(alertIfNewBrowser(user, origin, knownDevice).catch((err) => log.warn('login alert failed', { userId: user.id, err })));
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

async function alertIfNewBrowser(user: User, origin: SessionOrigin, knownDevice: boolean): Promise<void> {
  const isNew = await recordLogin(user.id, origin);
  if (knownDevice || !isNew || !user.loginAlertEmail || !user.email || !isEmailDeliveryConfigured()) return;
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
  await db.delete(knownLogins).where(lt(knownLogins.lastLoginAt, knownLoginCutoff(new Date())));
}
