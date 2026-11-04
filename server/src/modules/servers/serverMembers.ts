import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { serverMemberRoles, serverMembers, servers, users } from '../../db/schema.js';
import { toSocialUser, type SocialUser } from '../users/users.js';
import { SOCIAL_PAGE_SIZE, decodeTimeCursor, encodeTimeCursor } from '../friendships/cursor.js';

export interface ServerMemberEntry { user: SocialUser; roleIds: string[]; isOwner: boolean; at: string }

const joinedAtIso = sql<string>`to_char(${serverMembers.joinedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** One page of a server's members, oldest membership first, each with the
 * roles they hold. NO access check — the caller authorizes (a member for the
 * member list, an active admin for the administrative detail). */
export async function pageServerMembers(
  serverId: string, cursorRaw?: string,
): Promise<{ items: ServerMemberEntry[]; nextCursor: string | null } | 'not_found' | 'invalid_cursor'> {
  const cursor = cursorRaw ? decodeTimeCursor(cursorRaw) : null;
  if (cursorRaw && !cursor) return 'invalid_cursor';
  const [server] = await db.select({ ownerId: servers.ownerId }).from(servers).where(eq(servers.id, serverId)).limit(1);
  if (!server) return 'not_found';

  const rows = await db
    .select({ ts: joinedAtIso, user: users })
    .from(serverMembers)
    .innerJoin(users, eq(users.id, serverMembers.userId))
    .where(and(
      eq(serverMembers.serverId, serverId),
      cursor ? sql`(${serverMembers.joinedAt}, ${serverMembers.userId}) > (${cursor.ts}::timestamptz, ${cursor.id})` : undefined,
    ))
    .orderBy(asc(serverMembers.joinedAt), asc(serverMembers.userId))
    .limit(SOCIAL_PAGE_SIZE + 1);
  const page = rows.slice(0, SOCIAL_PAGE_SIZE);
  const roleRows = page.length
    ? await db.select().from(serverMemberRoles).where(and(eq(serverMemberRoles.serverId, serverId), inArray(serverMemberRoles.userId, page.map((r) => r.user.id))))
    : [];
  const roles = new Map<string, string[]>();
  for (const r of roleRows) roles.set(r.userId, [...(roles.get(r.userId) ?? []), r.roleId]);
  const last = page[page.length - 1];
  return {
    items: page.map((r) => ({ user: toSocialUser(r.user), roleIds: roles.get(r.user.id) ?? [], isOwner: r.user.id === server.ownerId, at: r.ts })),
    nextCursor: rows.length > SOCIAL_PAGE_SIZE && last ? encodeTimeCursor(last.ts, last.user.id) : null,
  };
}
