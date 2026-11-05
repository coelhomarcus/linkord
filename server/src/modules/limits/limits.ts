import { and, eq, or, sql } from 'drizzle-orm';
import { config } from '../../config/env.js';
import { db } from '../../db/client.js';
import { attachments, friendships, messages, serverMembers, servers } from '../../db/schema.js';
import type { Tx } from '../users/userPairLock.js';
import { stagedBytes } from '../attachments/stagedAttachments.js';

// Per-account quotas (docs/plano-rede-social.md §6.6, §10.2.8). The numbers
// live in config (initial guesses, tunable); this module is the one place
// that says what is counted and when something is over.

export type LimitKind = 'storage' | 'ownedServers' | 'serverMemberships' | 'friends' | 'pendingRequests';

export const limitMax = (kind: LimitKind, cfg = config): number => {
  switch (kind) {
    case 'storage': return cfg.MAX_USER_STORAGE_BYTES;
    case 'ownedServers': return cfg.MAX_OWNED_SERVERS_PER_USER;
    case 'serverMemberships': return cfg.MAX_SERVER_MEMBERSHIPS_PER_USER;
    case 'friends': return cfg.MAX_FRIENDS;
    case 'pendingRequests': return cfg.MAX_PENDING_OUTGOING_REQUESTS;
  }
};

/** Would adding `adding` on top of `used` go past `max`? (`used + adding` may
 * equal `max`.) */
export function exceedsLimit(used: number, max: number, adding = 1): boolean {
  return used + adding > max;
}

type Executor = Tx | typeof db;

async function countOwnedServers(userId: string, executor: Executor = db): Promise<number> {
  const [row] = await executor.select({ n: sql<number>`count(*)::int` }).from(servers).where(eq(servers.ownerId, userId));
  return row?.n ?? 0;
}

export async function countServerMemberships(userId: string, executor: Executor = db): Promise<number> {
  const [row] = await executor.select({ n: sql<number>`count(*)::int` }).from(serverMembers).where(eq(serverMembers.userId, userId));
  return row?.n ?? 0;
}

export async function countFriends(userId: string, executor: Executor = db): Promise<number> {
  const [row] = await executor.select({ n: sql<number>`count(*)::int` }).from(friendships)
    .where(and(eq(friendships.status, 'accepted'), or(eq(friendships.userLowId, userId), eq(friendships.userHighId, userId))));
  return row?.n ?? 0;
}

export async function countPendingOutgoing(userId: string, executor: Executor = db): Promise<number> {
  const [row] = await executor.select({ n: sql<number>`count(*)::int` }).from(friendships)
    .where(and(eq(friendships.status, 'pending'), eq(friendships.requestedBy, userId)));
  return row?.n ?? 0;
}

/** Bytes attributable to the account: every file (thumbnails included, they
 * take disk too) on a message it authored. Avatars/banners are not counted
 * here, same as the instance-wide figure (attachmentQuota.getUsage). */
export async function getUserStorageBytes(userId: string): Promise<number> {
  const [row] = await db.select({ bytes: sql<number>`coalesce(sum(${attachments.size}), 0)::float8` }).from(attachments)
    .innerJoin(messages, eq(messages.id, attachments.messageId))
    .where(eq(messages.authorId, userId));
  return Number(row?.bytes ?? 0) + (await stagedBytes(userId)).bytes;
}

export interface UserLimits {
  storage: { used: number; max: number };
  ownedServers: { used: number; max: number };
  serverMemberships: { used: number; max: number };
  friends: { used: number; max: number };
  pendingRequests: { used: number; max: number };
}

/** What the account itself may see about its own quotas — the instance-wide
 * total is an administrative figure (§8.3). */
export async function getUserLimits(userId: string): Promise<UserLimits> {
  const [storage, ownedServers, serverMemberships, friends, pendingRequests] = await Promise.all([
    getUserStorageBytes(userId), countOwnedServers(userId), countServerMemberships(userId), countFriends(userId), countPendingOutgoing(userId),
  ]);
  return {
    storage: { used: storage, max: limitMax('storage') },
    ownedServers: { used: ownedServers, max: limitMax('ownedServers') },
    serverMemberships: { used: serverMemberships, max: limitMax('serverMemberships') },
    friends: { used: friends, max: limitMax('friends') },
    pendingRequests: { used: pendingRequests, max: limitMax('pendingRequests') },
  };
}

/** Which server quota (if any) creating one more server would break. */
export async function serverCreationBlockedBy(userId: string): Promise<'ownedServers' | 'serverMemberships' | null> {
  if (exceedsLimit(await countOwnedServers(userId), limitMax('ownedServers'))) return 'ownedServers';
  if (exceedsLimit(await countServerMemberships(userId), limitMax('serverMemberships'))) return 'serverMemberships';
  return null;
}
