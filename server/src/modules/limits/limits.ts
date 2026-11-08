import { and, eq, or, sql } from 'drizzle-orm';
import { config } from '../../config/env.js';
import { db } from '../../db/client.js';
import { friendships, serverMembers, servers } from '../../db/schema.js';
import type { Tx } from '../users/userPairLock.js';

// Per-account quota values live in config; this module defines what each quota counts.

export type LimitKind = 'ownedServers' | 'serverMemberships' | 'friends' | 'pendingRequests';

export const limitMax = (kind: LimitKind, cfg = config): number => {
  switch (kind) {
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

export interface UserLimits {
  ownedServers: { used: number; max: number };
  serverMemberships: { used: number; max: number };
  friends: { used: number; max: number };
  pendingRequests: { used: number; max: number };
}

/** What the account itself may see about its own quotas — the instance-wide
 * total is an administrative figure (§8.3). */
export async function getUserLimits(userId: string): Promise<UserLimits> {
  const [ownedServers, serverMemberships, friends, pendingRequests] = await Promise.all([
    countOwnedServers(userId), countServerMemberships(userId), countFriends(userId), countPendingOutgoing(userId),
  ]);
  return {
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
