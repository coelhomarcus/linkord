import { asc, eq, inArray } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  channelPermissionOverwrites, conversations, serverCategories, serverMemberRoles, serverMembers, serverRoles, servers,
  type Server, type ServerCategory, type ServerRole,
} from '../../db/schema.js';
import {
  computeBasePermissions, computeChannelPermissions, hasPermission, PERMISSIONS,
  type MemberInput, type OverwriteInput,
} from './permissions.js';

// Who may do what in a server, answered from one in-memory snapshot per
// server instead of four queries on every message, typing ping and fan-out.
// The server runs as a single process, so dropping the snapshot on every
// write that changes it (invalidateServer) keeps it exact. A leaf module on
// purpose: everything that gates a channel imports it, and it imports
// nothing back but the database.

export interface ChannelShape {
  id: string;
  serverId: string;
  type: 'text' | 'voice';
  title: string;
  topic: string;
  categoryId: string | null;
  position: number;
  permissionsSynced: boolean;
  createdAt: Date;
}

export interface ServerSnapshot {
  server: Server;
  roles: ServerRole[];
  members: Map<string, { roleIds: string[]; position: number; joinedAt: Date }>;
  categories: ServerCategory[];
  channels: ChannelShape[];
  /** channel or category id → its overwrites */
  overwrites: Map<string, OverwriteInput[]>;
}

const cache = new Map<string, Promise<ServerSnapshot | null>>();

async function loadSnapshot(serverId: string): Promise<ServerSnapshot | null> {
  const [server] = await db.select().from(servers).where(eq(servers.id, serverId)).limit(1);
  if (!server) return null;
  const [roles, memberRows, memberRoleRows, categories, channelRows, overwriteRows] = await Promise.all([
    db.select().from(serverRoles).where(eq(serverRoles.serverId, serverId)).orderBy(asc(serverRoles.position)),
    db.select().from(serverMembers).where(eq(serverMembers.serverId, serverId)),
    db.select().from(serverMemberRoles).where(eq(serverMemberRoles.serverId, serverId)),
    db.select().from(serverCategories).where(eq(serverCategories.serverId, serverId)).orderBy(asc(serverCategories.position), asc(serverCategories.createdAt)),
    db.select().from(conversations).where(eq(conversations.serverId, serverId)).orderBy(asc(conversations.position), asc(conversations.createdAt)),
    db.select().from(channelPermissionOverwrites).where(eq(channelPermissionOverwrites.serverId, serverId)),
  ]);
  const members = new Map<string, { roleIds: string[]; position: number; joinedAt: Date }>();
  for (const row of memberRows) members.set(row.userId, { roleIds: [], position: row.position, joinedAt: row.joinedAt });
  for (const row of memberRoleRows) members.get(row.userId)?.roleIds.push(row.roleId);
  const overwrites = new Map<string, OverwriteInput[]>();
  for (const row of overwriteRows) {
    const target = (row.channelId ?? row.categoryId)!;
    const list = overwrites.get(target) ?? [];
    list.push({ roleId: row.roleId, userId: row.userId, allow: row.allow, deny: row.deny });
    overwrites.set(target, list);
  }
  const channels = channelRows.map((row) => ({
    id: row.id, serverId, type: row.type === 'voice' ? 'voice' as const : 'text' as const, title: row.title, topic: row.topic,
    categoryId: row.categoryId, position: row.position, permissionsSynced: row.permissionsSynced, createdAt: row.createdAt,
  }));
  return { server, roles, members, categories, channels, overwrites };
}

export function loadServerSnapshot(serverId: string): Promise<ServerSnapshot | null> {
  let entry = cache.get(serverId);
  if (!entry) {
    entry = loadSnapshot(serverId);
    cache.set(serverId, entry);
    entry.catch(() => { if (cache.get(serverId) === entry) cache.delete(serverId); });
  }
  return entry;
}

/** Call after ANY write to a server's row, members, roles, member roles,
 * categories, channels or overwrites. */
export function invalidateServer(serverId: string): void {
  cache.delete(serverId);
}

/** For writes that reach many servers at once (an account deleted, an admin
 * repair) where working out which ones isn't worth it. */
export function invalidateAllServers(): void {
  cache.clear();
}

export function memberInput(snapshot: ServerSnapshot, userId: string): MemberInput | null {
  const member = snapshot.members.get(userId);
  if (!member) return null;
  return { userId, roleIds: member.roleIds, isOwner: snapshot.server.ownerId === userId };
}

/** Server-wide permissions of a member; 0 for a non-member or while the
 * server is suspended, which closes every channel at once. */
export function basePermissionsIn(snapshot: ServerSnapshot, userId: string): number {
  const member = memberInput(snapshot, userId);
  if (!member || snapshot.server.status !== 'active') return 0;
  return computeBasePermissions(member, snapshot.roles);
}

export function channelOverwrites(snapshot: ServerSnapshot, channel: ChannelShape): OverwriteInput[] {
  const target = channel.permissionsSynced && channel.categoryId ? channel.categoryId : channel.id;
  return snapshot.overwrites.get(target) ?? [];
}

export function channelPermissionsIn(snapshot: ServerSnapshot, channelId: string, userId: string): number {
  const member = memberInput(snapshot, userId);
  const channel = snapshot.channels.find((c) => c.id === channelId);
  if (!member || !channel || snapshot.server.status !== 'active') return 0;
  return computeChannelPermissions(member, snapshot.roles, channelOverwrites(snapshot, channel));
}

/** The permissions a member has over a category itself — what decides
 * whether they see it (and edit it) in the channel list. */
export function categoryPermissionsIn(snapshot: ServerSnapshot, categoryId: string, userId: string): number {
  const member = memberInput(snapshot, userId);
  if (!member || snapshot.server.status !== 'active') return 0;
  return computeChannelPermissions(member, snapshot.roles, snapshot.overwrites.get(categoryId) ?? []);
}

/** The accounts that can currently see a channel — who a message there is
 * delivered to, who gets its push, who can be mentioned in it. */
export function channelViewerIds(snapshot: ServerSnapshot, channelId: string): string[] {
  return [...snapshot.members.keys()].filter((userId) => hasPermission(channelPermissionsIn(snapshot, channelId, userId), PERMISSIONS.VIEW_CHANNEL));
}

export async function channelPermissions(serverId: string, channelId: string, userId: string): Promise<number> {
  const snapshot = await loadServerSnapshot(serverId);
  return snapshot ? channelPermissionsIn(snapshot, channelId, userId) : 0;
}

export async function serverPermissions(serverId: string, userId: string): Promise<number> {
  const snapshot = await loadServerSnapshot(serverId);
  return snapshot ? basePermissionsIn(snapshot, userId) : 0;
}

/** Every server the account belongs to, in the account's own rail order. */
export async function serverIdsForUser(userId: string): Promise<string[]> {
  const rows = await db.select({ serverId: serverMembers.serverId }).from(serverMembers)
    .where(eq(serverMembers.userId, userId)).orderBy(asc(serverMembers.position), asc(serverMembers.joinedAt));
  return rows.map((r) => r.serverId);
}

/** The ids of every account that shares at least one server with `userId`. */
export async function serverPeerIds(userId: string): Promise<string[]> {
  const ids = await serverIdsForUser(userId);
  if (!ids.length) return [];
  const rows = await db.selectDistinct({ userId: serverMembers.userId }).from(serverMembers).where(inArray(serverMembers.serverId, ids));
  return rows.map((r) => r.userId).filter((id) => id !== userId);
}
