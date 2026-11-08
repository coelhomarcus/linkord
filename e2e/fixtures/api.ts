import type { APIRequestContext, APIResponse } from '@playwright/test';

/** Server-side setup through the app's own HTTP routes, never raw SQL: the
 * app caches memberships in memory, so only its own flows are visible to it. */

async function ok<T>(response: APIResponse, what: string): Promise<T> {
  if (!response.ok()) throw new Error(`${what}: HTTP ${response.status()} ${await response.text()}`);
  return (await response.json().catch(() => ({}))) as T;
}

interface Channel { id: string; name: string; type: 'text' | 'voice' }
export interface CreatedServer {
  id: string;
  name: string;
  channels: Channel[];
  text: Channel;
  voice: Channel;
  /** the @everyone role, the target for server-wide channel overwrites */
  everyoneRoleId: string;
}

export const PERMISSIONS = {
  VIEW_CHANNEL: 1 << 7,
  SEND_MESSAGES: 1 << 8,
  VIEW_AUDIT_LOG: 1 << 19,
} as const;

export async function createServer(api: APIRequestContext, name: string): Promise<CreatedServer> {
  const body = await ok<{ server: { id: string; name: string; channels: Channel[]; roles: { id: string; isDefault: boolean }[] } }>(
    await api.post('/api/servers', { data: { name } }), 'create server');
  const channels = body.server.channels;
  const text = channels.find((c) => c.type === 'text');
  const voice = channels.find((c) => c.type === 'voice');
  const everyone = body.server.roles.find((r) => r.isDefault);
  if (!text || !voice || !everyone) throw new Error('the server template has no text channel, voice channel or @everyone role');
  return { id: body.server.id, name: body.server.name, channels, text, voice, everyoneRoleId: everyone.id };
}

export async function createChannel(api: APIRequestContext, serverId: string, name: string, type: 'text' | 'voice' = 'text'): Promise<string> {
  const body = await ok<{ channelId: string }>(await api.post(`/api/servers/${serverId}/channels`, { data: { name, type } }), 'create channel');
  return body.channelId;
}

/** Allow/deny bits for a role on one channel (see PERMISSIONS). */
export async function setChannelOverwrite(api: APIRequestContext, serverId: string, channelId: string, roleId: string, allow: number, deny: number): Promise<void> {
  await ok(await api.put(`/api/servers/${serverId}/overwrites/${channelId}`, { data: { roleId, allow, deny } }), 'set overwrite');
}

export async function createInvite(api: APIRequestContext, serverId: string): Promise<string> {
  const body = await ok<{ invite: { code: string } }>(await api.post(`/api/servers/${serverId}/invites`, { data: {} }), 'create invite');
  return body.invite.code;
}

export async function acceptInvite(api: APIRequestContext, code: string): Promise<void> {
  await ok(await api.post(`/api/invites/${code}/accept`, { data: {} }), 'accept invite');
}

async function sendFriendRequest(api: APIRequestContext, username: string): Promise<void> {
  await ok(await api.post('/api/friend-requests', { data: { username } }), 'send friend request');
}

async function acceptFriendRequest(api: APIRequestContext, fromUserId: string): Promise<void> {
  await ok(await api.post(`/api/friend-requests/${fromUserId}/accept`, { data: {} }), 'accept friend request');
}

/** `a` asks, `b` accepts: they are friends (DMs and DM calls need that). */
export async function befriend(a: { api: APIRequestContext; id: string }, b: { api: APIRequestContext; username: string }): Promise<void> {
  await sendFriendRequest(a.api, b.username);
  await acceptFriendRequest(b.api, a.id);
}
