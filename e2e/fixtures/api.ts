import { expect, type APIRequestContext, type APIResponse } from '@playwright/test';

/** Server-side setup through the app's own HTTP routes, never raw SQL: the
 * app caches memberships in memory, so only its own flows are visible to it. */

async function ok<T>(response: APIResponse, what: string): Promise<T> {
  if (!response.ok()) throw new Error(`${what}: HTTP ${response.status()} ${await response.text()}`);
  return (await response.json().catch(() => ({}))) as T;
}

export interface Channel { id: string; name: string; type: 'text' | 'voice' }
export interface CreatedServer { id: string; name: string; channels: Channel[]; text: Channel; voice: Channel }

export async function createServer(api: APIRequestContext, name: string): Promise<CreatedServer> {
  const body = await ok<{ server: { id: string; name: string; channels: Channel[] } }>(
    await api.post('/api/servers', { data: { name } }), 'create server');
  const channels = body.server.channels;
  const text = channels.find((c) => c.type === 'text');
  const voice = channels.find((c) => c.type === 'voice');
  if (!text || !voice) throw new Error('the server template has no text or no voice channel');
  return { id: body.server.id, name: body.server.name, channels, text, voice };
}

export async function createInvite(api: APIRequestContext, serverId: string): Promise<string> {
  const body = await ok<{ invite: { code: string } }>(await api.post(`/api/servers/${serverId}/invites`, { data: {} }), 'create invite');
  return body.invite.code;
}

export async function acceptInvite(api: APIRequestContext, code: string): Promise<void> {
  await ok(await api.post(`/api/invites/${code}/accept`, { data: {} }), 'accept invite');
}

export async function sendFriendRequest(api: APIRequestContext, username: string): Promise<void> {
  await ok(await api.post('/api/friend-requests', { data: { username } }), 'send friend request');
}

export async function acceptFriendRequest(api: APIRequestContext, fromUserId: string): Promise<void> {
  await ok(await api.post(`/api/friend-requests/${fromUserId}/accept`, { data: {} }), 'accept friend request');
}

export async function me(api: APIRequestContext): Promise<{ id: string; username: string }> {
  const body = await ok<{ user: { id: string; username: string } }>(await api.get('/api/auth/me'), 'me');
  return body.user;
}

export async function expectStatus(response: APIResponse, status: number): Promise<void> {
  expect(response.status(), await response.text()).toBe(status);
}
