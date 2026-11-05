import { participants, send, sendToUser } from '../presence/participants.js';
import { hasPermission, PERMISSIONS } from './permissions.js';
import {
  basePermissionsIn, channelPermissionsIn, loadServerSnapshot, serverIdsForUser, type ServerSnapshot,
} from './serverAccess.js';

// What a member's client knows about a server: its channels and categories
// as THIS member sees them (hidden channels are simply absent), the roles,
// and the member's own effective permissions — the client reads bits, it
// never resolves them (see permissions.ts).

interface RoleSummary {
  id: string;
  name: string;
  color: string;
  position: number;
  permissions: number;
  hoist: boolean;
  mentionable: boolean;
  isDefault: boolean;
}

interface CategorySummary { id: string; name: string; position: number }

interface ChannelSummary {
  id: string;
  serverId: string;
  type: 'text' | 'voice';
  name: string;
  topic: string;
  categoryId: string | null;
  position: number;
  permissionsSynced: boolean;
  permissions: number;
}

export interface ServerSummary {
  id: string;
  name: string;
  icon: string;
  ownerId: string | null;
  status: 'active' | 'suspended';
  createdAt: number;
  memberCount: number;
  /** the member's own order of this server in their rail */
  position: number;
  permissions: number;
  myRoleIds: string[];
  roles: RoleSummary[];
  categories: CategorySummary[];
  channels: ChannelSummary[];
}

export function buildServerSummary(snapshot: ServerSnapshot, userId: string): ServerSummary | null {
  const member = snapshot.members.get(userId);
  if (!member) return null;
  const permissions = basePermissionsIn(snapshot, userId);
  const channels = snapshot.channels
    .map((channel) => ({ channel, permissions: channelPermissionsIn(snapshot, channel.id, userId) }))
    .filter(({ permissions: granted }) => hasPermission(granted, PERMISSIONS.VIEW_CHANNEL))
    .map(({ channel, permissions: granted }) => ({
      id: channel.id, serverId: channel.serverId, type: channel.type, name: channel.title, topic: channel.topic,
      categoryId: channel.categoryId, position: channel.position, permissionsSynced: channel.permissionsSynced, permissions: granted,
    }));
  // a category with nothing visible in it is hidden too — unless the member
  // can manage channels, who needs it to drop channels into
  const canManageChannels = hasPermission(permissions, PERMISSIONS.MANAGE_CHANNELS);
  const usedCategories = new Set(channels.map((c) => c.categoryId));
  const categories = snapshot.categories
    .filter((category) => canManageChannels || usedCategories.has(category.id))
    .map((category) => ({ id: category.id, name: category.name, position: category.position }));
  return {
    id: snapshot.server.id,
    name: snapshot.server.name,
    icon: snapshot.server.icon,
    ownerId: snapshot.server.ownerId,
    status: snapshot.server.status === 'suspended' ? 'suspended' : 'active',
    createdAt: snapshot.server.createdAt.getTime(),
    memberCount: snapshot.members.size,
    position: member.position,
    permissions,
    myRoleIds: member.roleIds,
    roles: snapshot.roles.map((role) => ({
      id: role.id, name: role.name, color: role.color, position: role.position, permissions: role.permissions,
      hoist: role.hoist, mentionable: role.mentionable, isDefault: role.isDefault,
    })),
    categories,
    channels,
  };
}

export async function listServersForUser(userId: string): Promise<ServerSummary[]> {
  const ids = await serverIdsForUser(userId);
  const summaries = await Promise.all(ids.map(async (id) => {
    const snapshot = await loadServerSnapshot(id);
    return snapshot ? buildServerSummary(snapshot, userId) : null;
  }));
  return summaries.filter((s): s is ServerSummary => s !== null);
}

/** Sends every connected member their own fresh summary of the server —
 * after anything that may change what they see or may do there. Call
 * invalidateServer first. */
export async function sendServerUpdateToMembers(serverId: string, t: 'server-created' | 'server-updated' = 'server-updated', only?: readonly string[]): Promise<void> {
  const snapshot = await loadServerSnapshot(serverId);
  if (!snapshot) return;
  const audience = only ? new Set(only) : null;
  const byUser = new Map<string, ServerSummary | null>();
  for (const p of participants.values()) {
    if (!snapshot.members.has(p.userId) || (audience && !audience.has(p.userId))) continue;
    if (!byUser.has(p.userId)) byUser.set(p.userId, buildServerSummary(snapshot, p.userId));
    const summary = byUser.get(p.userId);
    if (summary) send(p.socket, { t, server: summary });
  }
}

/** The server is gone from this account's list — it left, was kicked or
 * banned, or the server was deleted. */
export function sendServerRemoved(userId: string, serverId: string, reason?: 'removed' | 'banned' | 'deleted'): void {
  sendToUser(userId, { t: 'server-deleted', serverId, ...(reason ? { reason } : {}) });
}

/** A small event to every connected member (a member joined or left — the
 * member list and counts update from it). */
export async function broadcastToServerMembers(serverId: string, obj: { t: string; [key: string]: unknown }): Promise<void> {
  const snapshot = await loadServerSnapshot(serverId);
  if (!snapshot) return;
  for (const p of participants.values()) {
    if (snapshot.members.has(p.userId)) send(p.socket, obj);
  }
}
