import crypto from 'node:crypto';
import { and, desc, eq, inArray, lt, ne, or } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { sessions, users } from '../../db/schema.js';
import { config } from '../../config/env.js';
import type { SessionUser } from '../../types.js';
import { resolveLocale } from '../users/locale.js';

// Login sessions. The cookie carries a raw 32-byte token; only its sha256
// (`tokenHash`) is stored — a DB leak alone can't be replayed as a session.
//
// The DB is remote, so resolving the session on every Socket.IO handshake/
// HTTP request would be a WAN round-trip per reconnect. Hence a 60s
// in-memory cache; profile saves and logout/account deletion invalidate the
// affected entries explicitly.
//
// `lastSeenAt` feeds the account's session list and the idle expiry
// (SESSION_IDLE_DAYS). It is rewritten at most once a minute per session: a
// cached session is not read at all, and a read only writes when the stored
// value is older than that. A socket that stays connected makes no request,
// so the periodic sweep touches the sessions behind live sockets instead.

const SESSION_CACHE_TTL_MS = 60 * 1000;
const LAST_SEEN_STALE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function idleCutoff(): Date | null {
  return config.SESSION_IDLE_DAYS > 0 ? new Date(Date.now() - config.SESSION_IDLE_DAYS * DAY_MS) : null;
}

interface CacheEntry {
  value: SessionUser;
  expiresAtMs: number;
}

const cache = new Map<string, CacheEntry>(); // tokenHash -> { value, expiresAtMs }

function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

function cacheGet(tokenHash: string): SessionUser | undefined {
  const entry = cache.get(tokenHash);
  if (!entry) return undefined;
  if (entry.expiresAtMs < Date.now()) { cache.delete(tokenHash); return undefined; }
  return entry.value;
}

function cacheSet(tokenHash: string, value: SessionUser): void {
  cache.set(tokenHash, { value, expiresAtMs: Date.now() + SESSION_CACHE_TTL_MS });
}

function cacheInvalidate(tokenHash: string): void {
  cache.delete(tokenHash);
}

export interface SessionOrigin { ip: string; userAgent: string }

/** Creates a new session and returns the RAW token (goes in the cookie) —
 * never persisted in plaintext, only the hash. */
export async function createSession(userId: string, origin: SessionOrigin = { ip: '', userAgent: '' }): Promise<{ rawToken: string; expiresAt: Date; id: string }> {
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashToken(rawToken);
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + config.SESSION_TTL_DAYS * DAY_MS);
  await db.insert(sessions).values({ tokenHash, id, userId, expiresAt, ip: origin.ip.slice(0, 64), userAgent: origin.userAgent.slice(0, 512) });
  return { rawToken, expiresAt, id };
}

/** Whether a stored session may still be used: not past its TTL nor idle past SESSION_IDLE_DAYS. */
function isSessionLive(row: { expiresAt: Date; lastSeenAt: Date }, now = Date.now()): boolean {
  if (row.expiresAt.getTime() < now) return false;
  return !(config.SESSION_IDLE_DAYS > 0 && now - row.lastSeenAt.getTime() > config.SESSION_IDLE_DAYS * DAY_MS);
}

/** Resolves a raw token (from a cookie) to the session's owner, or null if
 * invalid/expired/nonexistent. */
export async function resolveSession(rawToken: string | undefined | null): Promise<SessionUser | null> {
  if (!rawToken) return null;
  const tokenHash = hashToken(rawToken);
  const cached = cacheGet(tokenHash);
  if (cached !== undefined) return cached;

  const [row] = await db
    .select({
      tokenHash: sessions.tokenHash,
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      lastSeenAt: sessions.lastSeenAt,
      userId: users.id,
      username: users.username,
      email: users.email,
      displayName: users.displayName,
      avatar: users.avatar,
      avatarPoster: users.avatarPoster,
      avatarColor: users.avatarColor,
      banner: users.banner,
      bannerPoster: users.bannerPoster,
      bio: users.bio,
      profileLinks: users.profileLinks,
      role: users.role,
      locale: users.locale,
      status: users.status,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.tokenHash, tokenHash))
    .limit(1);

  // a suspended account holds no session, whatever the DB row says
  if (!row || row.status !== 'active') {
    cacheInvalidate(tokenHash);
    return null;
  }
  if (!isSessionLive(row)) {
    cacheInvalidate(tokenHash);
    // an idle one would otherwise wait for the sweep; deleting it now keeps the session list honest
    // (awaited: it only happens once per dead session, and the refusal must not be undone by a race)
    await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash)).catch(() => {});
    return null;
  }

  if (Date.now() - row.lastSeenAt.getTime() > LAST_SEEN_STALE_MS) {
    // fire-and-forget: a delay/error here shouldn't block resolving the session
    db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.tokenHash, tokenHash)).catch(() => {});
  }

  const value: SessionUser = {
    tokenHash,
    sessionId: row.sessionId,
    userId: row.userId,
    username: row.username,
    email: row.email,
    // '' (never set) falls back to username — mirrors publicUser() in
    // auth/users.ts, duplicated here (not imported) to avoid a session.ts
    // <-> users.ts import cycle (users.ts already imports from this file).
    displayName: row.displayName.trim() || row.username,
    avatar: row.avatar,
    avatarPoster: row.avatarPoster,
    avatarColor: row.avatarColor,
    banner: row.banner,
    bannerPoster: row.bannerPoster,
    bio: row.bio,
    profileLinks: Array.isArray(row.profileLinks) ? row.profileLinks : [],
    role: row.role as SessionUser['role'],
    locale: resolveLocale(row.locale),
  };
  cacheSet(tokenHash, value);
  return value;
}

/** Ends the session behind a cookie. Returns its token hash (to cut its sockets), or null when there
 * was no token. */
export async function destroySession(rawToken: string | undefined | null): Promise<string | null> {
  if (!rawToken) return null;
  const tokenHash = hashToken(rawToken);
  cacheInvalidate(tokenHash);
  await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
  return tokenHash;
}

export async function destroyAllSessionsForUser(userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
  invalidateSessionsForUser(userId);
}

export interface SessionSummary {
  id: string;
  ip: string;
  userAgent: string;
  createdAt: Date;
  lastSeenAt: Date;
}

/** The account's usable sessions, most recently used first. */
export async function listSessionsForUser(userId: string): Promise<SessionSummary[]> {
  const rows = await db.select({
    id: sessions.id, ip: sessions.ip, userAgent: sessions.userAgent, createdAt: sessions.createdAt,
    lastSeenAt: sessions.lastSeenAt, expiresAt: sessions.expiresAt,
  }).from(sessions).where(eq(sessions.userId, userId)).orderBy(desc(sessions.lastSeenAt));
  const now = Date.now();
  return rows.filter((row) => isSessionLive(row, now)).map(({ expiresAt: _expiresAt, ...rest }) => rest);
}

/** Ends one session of the account by its public id. Returns the ended session's token hash (to cut
 * its sockets), or null when the account has no such session. */
export async function destroySessionById(userId: string, sessionId: string): Promise<string | null> {
  const [row] = await db.delete(sessions)
    .where(and(eq(sessions.userId, userId), eq(sessions.id, sessionId)))
    .returning({ tokenHash: sessions.tokenHash });
  if (!row) return null;
  cacheInvalidate(row.tokenHash);
  return row.tokenHash;
}

/** Ends every session of the account except `keepTokenHash`. Returns the ended token hashes. */
export async function destroyOtherSessions(userId: string, keepTokenHash: string): Promise<string[]> {
  const rows = await db.delete(sessions)
    .where(and(eq(sessions.userId, userId), ne(sessions.tokenHash, keepTokenHash)))
    .returning({ tokenHash: sessions.tokenHash });
  for (const row of rows) cacheInvalidate(row.tokenHash);
  return rows.map((row) => row.tokenHash);
}

/** Marks sessions as just used — for the ones behind a socket that stayed connected, which otherwise
 * make no request that would refresh `lastSeenAt` and would expire as idle under a live tab. */
export async function touchSessions(tokenHashes: string[]): Promise<void> {
  if (tokenHashes.length === 0) return;
  await db.update(sessions).set({ lastSeenAt: new Date() }).where(inArray(sessions.tokenHash, tokenHashes));
}

/** Clears expired and idle sessions from the DB — called periodically at boot
 * (app/bootstrap.ts), not per request. */
export async function sweepExpiredSessions(): Promise<void> {
  const idle = idleCutoff();
  const expired = lt(sessions.expiresAt, new Date());
  await db.delete(sessions).where(idle ? or(expired, lt(sessions.lastSeenAt, idle)) : expired);
}

/** Called by modules/moderation.ts when deleting an account — the sessions
 * row is already gone via CASCADE, but this local cache can hold a VALID
 * entry for up to SESSION_CACHE_TTL_MS after that (it only expires by time,
 * doesn't know the DB changed). Without this, someone just deleted would
 * stay authenticated for up to 60s. Scans the whole Map (no index by
 * userId, only tokenHash) — fine since the cache is small and account
 * deletion is rare. */
export function invalidateSessionsForUser(userId: string): void {
  for (const [tokenHash, entry] of cache) {
    if (entry.value && entry.value.userId === userId) cache.delete(tokenHash);
  }
}
