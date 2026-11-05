import { and, eq, or, sql } from 'drizzle-orm';
import { serverInvitations } from '../../db/schema.js';
import type { Tx } from '../users/userPairLock.js';
import { markNotificationsRead } from '../notifications/notificationsRepository.js';

// Leaf module (db/schema only) on purpose: blocks/ and friendships/ must
// invalidate pending invitations INSIDE their own transaction, while
// serverInvitationsRepository.ts imports both of them — a helper living there would
// make a cycle. Every function returns the revoked ids so the caller can push
// `invitation-updated` AFTER the commit.

/** Losing the friendship or blocking either party invalidates their pending invitation. */
export async function revokePendingBetween(tx: Tx, a: string, b: string): Promise<string[]> {
  const rows = await tx.update(serverInvitations)
    .set({ status: 'revoked', respondedAt: new Date(), version: sql`${serverInvitations.version} + 1` })
    .where(and(
      eq(serverInvitations.status, 'pending'),
      or(
        and(eq(serverInvitations.inviterId, a), eq(serverInvitations.inviteeId, b)),
        and(eq(serverInvitations.inviterId, b), eq(serverInvitations.inviteeId, a)),
      ),
    ))
    .returning({ id: serverInvitations.id });
  const ids = rows.map((r) => r.id);
  await markNotificationsRead(tx, { invitationIds: ids });
  return ids;
}

/** A suspended or deleted account can neither send nor answer an invitation. */
export async function revokePendingForUser(tx: Tx, userId: string): Promise<string[]> {
  const rows = await tx.update(serverInvitations)
    .set({ status: 'revoked', respondedAt: new Date(), version: sql`${serverInvitations.version} + 1` })
    .where(and(
      eq(serverInvitations.status, 'pending'),
      or(eq(serverInvitations.inviterId, userId), eq(serverInvitations.inviteeId, userId)),
    ))
    .returning({ id: serverInvitations.id });
  const ids = rows.map((r) => r.id);
  await markNotificationsRead(tx, { invitationIds: ids });
  return ids;
}
