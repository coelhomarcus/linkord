import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { userBadges } from '../../db/schema.js';
import type { Tx } from '../users/userPairLock.js';
import { sortBadges, type BadgeId, type BadgeSource } from './badgeCatalog.js';

/** A badge the account holds. A profile shows `id` and `grantedAt`; the admin panel also `source`. */
export interface HeldBadge { id: BadgeId; grantedAt: string; source: BadgeSource }

/** The account's badges, in catalog order. */
export async function listUserBadges(userId: string): Promise<HeldBadge[]> {
  const rows = await db.select({ id: userBadges.badge, grantedAt: userBadges.grantedAt, source: userBadges.source }).from(userBadges).where(eq(userBadges.userId, userId));
  return sortBadges(rows.map((row) => ({ id: row.id, grantedAt: row.grantedAt.toISOString(), source: row.source })));
}

/** Gives the badge unless the account already holds it, whoever granted it then. A rule that awards
 * badges on its own calls this with source 'automatic' and no `grantedBy`. */
export async function grantBadge(
  executor: Tx | typeof db,
  grant: { userId: string; badge: BadgeId; source: BadgeSource; grantedBy: string | null },
): Promise<'granted' | 'already_held'> {
  const rows = await executor.insert(userBadges).values(grant).onConflictDoNothing().returning({ badge: userBadges.badge });
  return rows.length > 0 ? 'granted' : 'already_held';
}

/** Takes the badge away. With `source`, only a row that source manages goes, so an automatic rule that
 * no longer applies never removes a badge an admin gave by hand. */
export async function revokeBadge(
  executor: Tx | typeof db,
  target: { userId: string; badge: BadgeId; source?: BadgeSource },
): Promise<'revoked' | 'not_held'> {
  const rows = await executor.delete(userBadges).where(and(
    eq(userBadges.userId, target.userId),
    eq(userBadges.badge, target.badge),
    target.source ? eq(userBadges.source, target.source) : undefined,
  )).returning({ badge: userBadges.badge });
  return rows.length > 0 ? 'revoked' : 'not_held';
}
