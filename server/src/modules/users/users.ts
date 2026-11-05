import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { users, type User } from '../../db/schema.js';
import type { Role } from '../../types.js';
import { resolveLocale, type Locale } from './locale.js';

// Account CRUD. Username uniqueness is case-insensitive (index on
// lower(username) in the schema) — every username lookup must use the
// SAME sql`lower(...)` expression, or Postgres won't use that index.

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  /** the first frame of an animated avatar ('' for a still one) */
  avatarPoster: string;
  avatarColor: string;
  banner: string;
  bio: string;
  profileLinks: string[];
  role: Role;
  lastSeenAt: string | null;
}

export interface PrivateUser extends PublicUser {
  email: string | null;
  locale: Locale;
}

/** '' (never set, or explicitly cleared) falls back to the immutable
 * username — every read of a user's displayName goes through this, so a
 * legacy row (from before this column existed) never surfaces as blank. */
export function resolveDisplayName(displayName: string, username: string): string {
  return displayName.trim() || username;
}

export function publicUser(u: User): PublicUser {
  return {
    id: u.id, username: u.username, displayName: resolveDisplayName(u.displayName, u.username),
    avatar: u.avatar, avatarPoster: u.avatarPoster, avatarColor: u.avatarColor, banner: u.banner, bio: u.bio,
    profileLinks: Array.isArray(u.profileLinks) ? u.profileLinks : [],
    role: u.role as Role,
    lastSeenAt: u.lastSeenAt ? u.lastSeenAt.toISOString() : null,
  };
}

/** Marks when the account's last live socket went away. Fire-and-forget from
 * presence so a brief network blip that already passed the grace window is
 * what peers (and admin) see as last seen — not every join. */
export async function recordUserLastSeen(userId: string, at: Date): Promise<void> {
  await db.update(users).set({ lastSeenAt: at }).where(eq(users.id, userId));
}

export function privateUser(u: User): PrivateUser {
  return { ...publicUser(u), email: u.email, locale: resolveLocale(u.locale) };
}

/** Keep list results minimal; callers may not be authorized to view the full profile. */
export interface SocialUser {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  avatarColor: string;
}

export function toSocialUser(u: User): SocialUser {
  return {
    id: u.id, username: u.username, displayName: resolveDisplayName(u.displayName, u.username),
    avatar: u.avatar, avatarColor: u.avatarColor,
  };
}

export async function findByUsernameLower(username: string): Promise<User | null> {
  const lower = username.trim().toLowerCase();
  const [row] = await db.select().from(users).where(sql`lower(${users.username}) = ${lower}`).limit(1);
  return row || null;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function findByEmailLower(email: string): Promise<User | null> {
  const lower = normalizeEmail(email);
  const [row] = await db.select().from(users).where(sql`lower(${users.email}) = ${lower}`).limit(1);
  return row || null;
}

export async function findById(id: string): Promise<User | null> {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row || null;
}

/** The "known users" projection sent in `welcome` — bounded to a specific
 * set of ids (friends ∪ conversation members), not everyone. Empty input
 * short-circuits: `inArray` with an empty array is a Drizzle footgun (some
 * versions render invalid SQL), and a brand-new account's known-peer set is
 * legitimately empty. */
export async function listUsersByIds(ids: string[]): Promise<PublicUser[]> {
  if (!ids.length) return [];
  const rows = await db.select().from(users).where(inArray(users.id, ids));
  return rows.map(publicUser);
}
