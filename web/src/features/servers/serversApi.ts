import { apiFetch } from '@/shared/api/api';
import type { InviteResult, SocialUser } from '@/shared/api/api';
import type { ServerSummary } from '@/shared/types/protocol';

// HTTP surface of servers (server/src/modules/servers): every write answers
// with little or nothing — the new state arrives as `server-updated`.

const json = (method: string, body?: unknown): RequestInit => ({ method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const id = encodeURIComponent;

export function createServer(name: string, inviteeIds: string[] = []): Promise<{ server: ServerSummary; channelId: string; results: InviteResult[] }> {
  return apiFetch('/api/servers', json('POST', { name, inviteeIds }));
}
export const updateServer = (serverId: string, patch: { name?: string; icon?: string }) => apiFetch(`/api/servers/${id(serverId)}`, json('PATCH', patch));
export const deleteServer = (serverId: string) => apiFetch(`/api/servers/${id(serverId)}`, json('DELETE'));
export const leaveServer = (serverId: string) => apiFetch(`/api/servers/${id(serverId)}/leave`, json('POST'));
export const transferServer = (serverId: string, userId: string) => apiFetch(`/api/servers/${id(serverId)}/transfer`, json('POST', { userId }));
export const saveServerOrder = (serverIds: string[]) => apiFetch('/api/servers/order', json('PUT', { serverIds }));

export interface ServerMemberEntry { user: SocialUser; roleIds: string[]; isOwner: boolean; at: string }
function fetchServerMembers(serverId: string, cursor: string | null = null): Promise<{ items: ServerMemberEntry[]; nextCursor: string | null }> {
  return apiFetch(`/api/servers/${id(serverId)}/members${cursor ? `?cursor=${id(cursor)}` : ''}`);
}
/** Every page, for the member list (servers are capped at a few hundred). */
export async function fetchAllServerMembers(serverId: string): Promise<ServerMemberEntry[]> {
  const all: ServerMemberEntry[] = [];
  let cursor: string | null = null;
  do {
    const page: { items: ServerMemberEntry[]; nextCursor: string | null } = await fetchServerMembers(serverId, cursor);
    all.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return all;
}
export const kickMember = (serverId: string, userId: string) => apiFetch(`/api/servers/${id(serverId)}/members/${id(userId)}`, json('DELETE'));
export const banMember = (serverId: string, userId: string, reason = '') => apiFetch(`/api/servers/${id(serverId)}/bans/${id(userId)}`, json('PUT', { reason }));
export const unbanMember = (serverId: string, userId: string) => apiFetch(`/api/servers/${id(serverId)}/bans/${id(userId)}`, json('DELETE'));
export function fetchBans(serverId: string): Promise<{ items: { user: SocialUser; reason: string; at: string }[] }> {
  return apiFetch(`/api/servers/${id(serverId)}/bans`);
}
export const setMemberRoles = (serverId: string, userId: string, roleIds: string[]) => apiFetch(`/api/servers/${id(serverId)}/members/${id(userId)}/roles`, json('PUT', { roleIds }));

export const createChannel = (serverId: string, input: { name: string; type: 'text' | 'voice'; categoryId?: string | null }) =>
  apiFetch<{ channelId: string }>(`/api/servers/${id(serverId)}/channels`, json('POST', input));
export const updateChannel = (channelId: string, patch: { name?: string; topic?: string; permissionsSynced?: true }) => apiFetch(`/api/channels/${id(channelId)}`, json('PATCH', patch));
export const deleteChannel = (channelId: string) => apiFetch(`/api/channels/${id(channelId)}`, json('DELETE'));
export const createCategory = (serverId: string, name: string) => apiFetch<{ categoryId: string }>(`/api/servers/${id(serverId)}/categories`, json('POST', { name }));

export interface Overwrite { roleId: string | null; userId: string | null; allow: number; deny: number }
export function fetchOverwrites(serverId: string, targetId: string): Promise<{ items: Overwrite[] }> {
  return apiFetch(`/api/servers/${id(serverId)}/overwrites/${id(targetId)}`);
}
export const setOverwrite = (serverId: string, targetId: string, overwrite: Overwrite) =>
  apiFetch(`/api/servers/${id(serverId)}/overwrites/${id(targetId)}`, json('PUT', { ...overwrite, roleId: overwrite.roleId ?? undefined, userId: overwrite.userId ?? undefined }));

export const createRole = (serverId: string, input: { name: string; color?: string; permissions?: number }) => apiFetch<{ roleId: string }>(`/api/servers/${id(serverId)}/roles`, json('POST', input));
export const updateRole = (roleId: string, patch: { name?: string; color?: string; permissions?: number; hoist?: boolean; mentionable?: boolean }) => apiFetch(`/api/roles/${id(roleId)}`, json('PATCH', patch));
export const deleteRole = (roleId: string) => apiFetch(`/api/roles/${id(roleId)}`, json('DELETE'));
export const saveRoleOrder = (serverId: string, roleIds: string[]) => apiFetch(`/api/servers/${id(serverId)}/roles/order`, json('PUT', { roleIds }));

export interface ServerInvite { code: string; serverId: string; channelId: string | null; createdBy: string | null; maxUses: number | null; uses: number; expiresAt: string | null; createdAt: string; creator?: SocialUser | null }
export const createInviteLink = (serverId: string, input: { maxAgeSeconds?: number; maxUses?: number; channelId?: string } = {}) =>
  apiFetch<{ invite: ServerInvite }>(`/api/servers/${id(serverId)}/invites`, json('POST', input));
export const fetchInviteLinks = (serverId: string) => apiFetch<{ items: ServerInvite[] }>(`/api/servers/${id(serverId)}/invites`);
export const revokeInviteLink = (code: string) => apiFetch(`/api/invites/${id(code)}`, json('DELETE'));
export interface InvitePreview { code: string; server: { id: string; name: string; icon: string; memberCount: number }; inviter: SocialUser | null; expiresAt: string | null; isMember: boolean }
export const fetchInvitePreview = (code: string) => apiFetch<InvitePreview>(`/api/invites/${id(code)}`);
export const acceptInviteLink = (code: string) => apiFetch<{ serverId: string; channelId: string | null; joined: boolean }>(`/api/invites/${id(code)}/accept`, json('POST'));

export interface WebhookInfo { id: string; name: string; avatar: string; createdAt: string; tokenRotatedAt: string; lastUsedAt: string | null }
export const fetchWebhooks = (channelId: string) => apiFetch<{ webhooks: WebhookInfo[] }>(`/api/channels/${id(channelId)}/webhooks`);
export const createWebhook = (channelId: string, name: string) => apiFetch<{ webhook: WebhookInfo & { token: string; url: string } }>(`/api/channels/${id(channelId)}/webhooks`, json('POST', { name }));
export const updateWebhook = (channelId: string, webhookId: string, changes: { name?: string; avatar?: string }) => apiFetch<{ webhook: WebhookInfo }>(`/api/channels/${id(channelId)}/webhooks/${id(webhookId)}`, json('PATCH', changes));
export const rotateWebhook = (channelId: string, webhookId: string) => apiFetch<{ webhook: { id: string; token: string; url: string } }>(`/api/channels/${id(channelId)}/webhooks/${id(webhookId)}/rotate`, json('POST'));
export const deleteWebhook = (channelId: string, webhookId: string) => apiFetch(`/api/channels/${id(channelId)}/webhooks/${id(webhookId)}`, json('DELETE'));

export const SERVER_AUDIT_ACTIONS = [
  'server.update', 'server.transfer',
  'member.kick', 'member.ban', 'member.unban', 'member.roles_update', 'member.voice_disconnect', 'member.voice_move',
  'role.create', 'role.update', 'role.delete', 'role.reorder',
  'channel.create', 'channel.update', 'channel.delete',
  'category.create', 'category.update', 'category.delete',
  'permissions.update',
  'invite.create', 'invite.revoke',
  'webhook.create', 'webhook.update', 'webhook.rotate', 'webhook.delete',
  'message.delete',
  'sound.create', 'sound.update', 'sound.delete',
  'emoji.create', 'emoji.update', 'emoji.delete',
  'sticker.create', 'sticker.update', 'sticker.delete',
] as const;
export type ServerAuditAction = (typeof SERVER_AUDIT_ACTIONS)[number];
export interface AuditChange { key: string; before: unknown; after: unknown }
export interface ServerAuditEntry {
  id: string; at: string; action: string;
  actorId: string | null; actorLabel: string; actor: SocialUser | null;
  targetType: string; targetId: string; targetLabel: string; targetUser: SocialUser | null;
  reason: string;
  detail: { changes?: AuditChange[]; [key: string]: unknown };
}
export interface ServerAuditFilters { action?: string; actor?: string; target?: string; from?: string; to?: string }
export function fetchServerAuditLog(serverId: string, filters: ServerAuditFilters, cursor: string | null = null): Promise<{ items: ServerAuditEntry[]; nextCursor: string | null }> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...filters, cursor })) if (value) query.set(key, value);
  const qs = query.toString();
  return apiFetch(`/api/servers/${id(serverId)}/audit-log${qs ? `?${qs}` : ''}`);
}
