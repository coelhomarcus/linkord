import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db, pool } from '../../src/db/client.js';
import { conversations, friendships, serverMembers, servers, users } from '../../src/db/schema.js';
import { join, participants } from '../../src/modules/presence/participants.js';
import { createServer } from '../../src/modules/servers/serversRepository.js';
import { invalidateAllServers } from '../../src/modules/servers/serverAccess.js';
import type { AppSocket, Participant } from '../../src/types.js';

// Shared setup for the real-Postgres suite. Every test makes its own users and
// servers (unique names), so files never depend on each other or on order.

export { db, pool };

export async function makeUser(prefix: string, role: 'user' | 'admin' = 'user'): Promise<{ id: string; username: string }> {
  const id = crypto.randomUUID();
  const username = `${prefix}_${id.slice(0, 8)}`;
  await db.insert(users).values({ id, username, passwordHash: 'x', role });
  return { id, username };
}

export async function befriend(a: string, b: string): Promise<void> {
  const [low, high] = a < b ? [a, b] : [b, a];
  await db.insert(friendships).values({ id: crypto.randomUUID(), userLowId: low, userHighId: high, requestedBy: a, status: 'accepted', acceptedAt: new Date() });
}

export interface TestServer { serverId: string; textChannelId: string; voiceChannelId: string }

/** A server from the template owned by `ownerId`, with `memberIds` added
 * straight into the table (oldest first), the way it would look after
 * invitations were accepted. */
export async function makeServerWithMembers(ownerId: string, memberIds: string[], name = 'itest'): Promise<TestServer> {
  const { serverId, firstTextChannelId } = await createServer(ownerId, name, 'pt-BR');
  for (let i = 0; i < memberIds.length; i++) {
    await db.insert(serverMembers).values({ serverId, userId: memberIds[i]!, joinedAt: new Date(Date.now() + i * 1000) });
  }
  const [voice] = await db.select({ id: conversations.id }).from(conversations).where(and(eq(conversations.serverId, serverId), eq(conversations.type, 'voice'))).limit(1);
  // a test that writes rows directly must not read a snapshot from before them
  invalidateAllServers();
  return { serverId, textChannelId: firstTextChannelId, voiceChannelId: voice!.id };
}

export async function ownerOf(serverId: string): Promise<string | null> {
  const [row] = await db.select({ ownerId: servers.ownerId }).from(servers).where(eq(servers.id, serverId)).limit(1);
  return row?.ownerId ?? null;
}

export async function memberCount(serverId: string): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(serverMembers).where(eq(serverMembers.serverId, serverId));
  return row?.n ?? 0;
}

/** A minimal socket good enough to drive a real presence/participants.ts or
 * conversations.ts handler — `sent` is a spy on `emit`, which is what
 * send()/sendSocketError() actually call, gated on `socket.connected`.
 * `user` is the real row from makeUser(): its `username` (not `id`) is what
 * join() falls back displayName to when empty, and a raw id (a 36-char
 * uuid) overflows display_name's varchar(32) the moment a test doesn't set
 * displayName itself first. */
export function fakeSocket(user: { id: string; username: string }): { socket: AppSocket; sent: { event: string; payload: any }[] } {
  const sent: { event: string; payload: any }[] = [];
  const socket = {
    participantId: null,
    ip: '127.0.0.1',
    connected: true,
    emit: (event: string, payload: any) => { sent.push({ event, payload }); },
    disconnect: () => {},
    user: {
      tokenHash: 'x', userId: user.id, username: user.username, displayName: '', avatar: '', avatarColor: 'blurple',
      banner: '', bio: '', profileLinks: [], role: 'user' as const,
    },
  } as unknown as AppSocket;
  return { socket, sent };
}

export function joinNew(user: { id: string; username: string }): { socket: AppSocket; sent: { event: string; payload: any }[]; participant: Participant } {
  const { socket, sent } = fakeSocket(user);
  const result = join(socket, {});
  assert.ok(result, 'join deveria criar o participante');
  return { socket, sent, participant: result.participant };
}

/** Drops the in-memory participant a joinNew() call registered — tests must
 * call this in a `finally` or participants.ts's module-level Map leaks one
 * entry per test for the rest of the process. */
export function cleanupParticipant(participant: Participant): void {
  if (participant.graceTimer) clearTimeout(participant.graceTimer);
  participants.delete(participant.id);
}

/** A real attachments row, the way avatarUpload.ts's encodeAndStoreProfileImage
 * writes one — needed so a profile/server-icon patch's ownership check
 * (isOwnedProfileImage) accepts the reference instead of silently clearing
 * it. */
export async function makeOwnedAvatarUpload(uploaderId: string): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, '');
  await pool.query(
    "insert into attachments (id, message_id, uploader_id, file_name, mime_type, size) values ($1, null, $2, 'avatar', 'image/jpeg', 1)",
    [id, uploaderId],
  );
  return `/uploads/${id}`;
}
