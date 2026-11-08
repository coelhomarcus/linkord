import fs from 'node:fs/promises';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, asc, count, eq } from 'drizzle-orm';
import { config } from '../../config/env.js';
import { db } from '../../db/client.js';
import { conversations, serverSounds, servers, users, type ServerSound, type User } from '../../db/schema.js';
import { jsonBody, sendError, sendJson } from '../../http/respond.js';
import { parseCookies } from '../../http/cookies.js';
import { resolveSession } from '../auth/session.js';
import { toSocialUser, type SocialUser } from '../users/users.js';
import { isSingleEmoji } from '../messages/emoji.js';
import { newId, filePathFor } from '../attachments/attachmentStorage.js';
import { getUsage } from '../attachments/attachmentQuota.js';
import { hasPermission, PERMISSIONS } from '../servers/permissions.js';
import { channelPermissionsIn, loadServerSnapshot, basePermissionsIn } from '../servers/serverAccess.js';
import { broadcastToServerMembers } from '../servers/serverSummaries.js';
import { createdFields, diffFields, recordServerAudit } from '../servers/serverAuditLog.js';
import { participants, send } from '../presence/participants.js';
import * as floodControl from '../../realtime/floodControl.js';
import { parseWav } from './soundFile.js';
import { logger } from '../../lib/logger.js';
import type { AppSocket, HandlerTable } from '../../types.js';

const log = logger.child({ component: 'soundboard' });

export const MAX_SOUNDS_PER_SERVER = 24;
// a little over 5s so a clip trimmed to exactly 5s never trips on rounding
const MAX_SOUND_DURATION_MS = 5200;
// 5.2s of 48kHz mono 16-bit PCM is ~500KB — the most the client ever produces
const MAX_SOUND_BYTES = 512 * 1024;
const MAX_SOUND_NAME_LEN = 32;

// generous for someone building a soundboard, not for a script filling disks
const SOUND_UPLOAD_LIMIT = { windowMs: 60_000, max: 10 };

interface SoundEntry {
  id: string;
  name: string;
  emoji: string;
  volume: number;
  durationMs: number;
  createdAt: number;
  uploader: SocialUser | null;
}

/** Single line, trimmed, capped — '' when nothing usable is left. */
export function sanitizeSoundName(value: unknown): string {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_SOUND_NAME_LEN);
}

/** '' (no emoji) or exactly one emoji; null for anything else. */
export function sanitizeSoundEmoji(value: unknown): string | null {
  const s = String(value == null ? '' : value).trim();
  if (!s) return '';
  return isSingleEmoji(s) ? s : null;
}

/** An integer 0..100, or null when it isn't a number at all. */
export function sanitizeSoundVolume(value: unknown): number | null {
  if (value === '' || value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function toEntry(row: ServerSound, uploader: User | null): SoundEntry {
  return {
    id: row.id,
    name: row.name,
    emoji: row.emoji,
    volume: row.volume,
    durationMs: row.durationMs,
    createdAt: row.createdAt.getTime(),
    uploader: uploader ? toSocialUser(uploader) : null,
  };
}

async function sessionUserId(request: FastifyRequest): Promise<string | null> {
  const cookies = parseCookies(request.headers.cookie || '');
  return (await resolveSession(cookies[config.SESSION_COOKIE]))?.userId ?? null;
}

/** A server's soundboard, as one of its members sees it: their server-wide
 * permissions there, or null when they aren't an active member. */
async function soundboardAccess(serverId: string, userId: string): Promise<{ permissions: number } | null> {
  const snapshot = await loadServerSnapshot(serverId);
  if (!snapshot || !snapshot.members.has(userId) || snapshot.server.status !== 'active') return null;
  return { permissions: basePermissionsIn(snapshot, userId) };
}

async function listSounds(serverId: string): Promise<SoundEntry[]> {
  const rows = await db.select({ sound: serverSounds, uploader: users })
    .from(serverSounds)
    .leftJoin(users, eq(users.id, serverSounds.uploaderId))
    .where(eq(serverSounds.serverId, serverId))
    .orderBy(asc(serverSounds.createdAt), asc(serverSounds.id));
  return rows.map((r) => toEntry(r.sound, r.uploader));
}

/** The uploader edits and removes their own sounds; MANAGE_EXPRESSIONS, any of them. */
function canEditSound(sound: ServerSound, userId: string, permissions: number): boolean {
  return sound.uploaderId === userId || hasPermission(permissions, PERMISSIONS.MANAGE_EXPRESSIONS);
}

function notifyChanged(serverId: string): void {
  broadcastToServerMembers(serverId, { t: 'server-sounds-changed', serverId }).catch((err) => {
    log.error('failed to broadcast soundboard change', err, { serverId });
  });
}

type ServerParams = { Params: { serverId: string } };
type SoundParams = { Params: { serverId: string; soundId: string } };

async function handleList(request: FastifyRequest<ServerParams>, reply: FastifyReply): Promise<void> {
  const userId = await sessionUserId(request);
  if (!userId) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');
  const serverId = String(request.params.serverId || '');
  if (!(await soundboardAccess(serverId, userId))) return sendError(reply, 404, 'not_found', 'Servidor não encontrado.');
  sendJson(reply, 200, { sounds: await listSounds(serverId), maxSounds: MAX_SOUNDS_PER_SERVER });
}

/** Raw WAV body; name/emoji/volume ride in the query string since the body
 * is the file itself (same shape as the avatar upload). */
async function handleUpload(
  request: FastifyRequest<ServerParams & { Querystring: { name?: string; emoji?: string; volume?: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const userId = await sessionUserId(request);
  if (!userId) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');
  const serverId = String(request.params.serverId || '');
  const access = await soundboardAccess(serverId, userId);
  if (!access) return sendError(reply, 404, 'not_found', 'Servidor não encontrado.');
  // adding to the soundboard is part of using it; curating everyone's is MANAGE_EXPRESSIONS
  if (!hasPermission(access.permissions, PERMISSIONS.USE_SOUNDBOARD)) return sendError(reply, 403, 'forbidden', 'Você não pode usar o soundboard desse servidor.');

  if (!floodControl.allow(`sound-upload:${userId}`, SOUND_UPLOAD_LIMIT)) {
    return sendError(reply, 429, 'rate_limited', 'Muitos sons enviados em pouco tempo. Tente de novo em instantes.');
  }

  const name = sanitizeSoundName(request.query.name);
  if (!name) return sendError(reply, 400, 'invalid_request', 'Dê um nome ao som.');
  const emoji = sanitizeSoundEmoji(request.query.emoji);
  if (emoji === null) return sendError(reply, 400, 'invalid_request', 'Emoji inválido.');
  const volume = sanitizeSoundVolume(request.query.volume) ?? 100;

  const buffer = request.body as Buffer;
  if (!buffer || buffer.length === 0) return sendError(reply, 400, 'empty_file', 'Arquivo vazio.');
  const wav = parseWav(buffer);
  if (!wav) return sendError(reply, 400, 'invalid_sound', 'Não foi possível ler esse áudio.');
  if (wav.durationMs > MAX_SOUND_DURATION_MS) return sendError(reply, 400, 'sound_too_long', 'O som pode ter no máximo 5 segundos.');

  const usage = await getUsage();
  if (usage.totalBytes + buffer.length > config.MAX_STORAGE_BYTES) {
    log.warn('sound upload refused: instance storage is full', { userId, size: buffer.length });
    return sendError(reply, 400, 'storage_full', 'Armazenamento cheio. Tente novamente mais tarde.');
  }

  const id = newId();
  await fs.writeFile(filePathFor(id), buffer);
  let inserted: ServerSound | null;
  try {
    // the server row lock serializes concurrent uploads, so two of them can't
    // both see 23 sounds and both insert the 24th
    inserted = await db.transaction(async (tx) => {
      await tx.select({ id: servers.id }).from(servers).where(eq(servers.id, serverId)).for('update');
      const [{ value: existing } = { value: 0 }] = await tx.select({ value: count() }).from(serverSounds).where(eq(serverSounds.serverId, serverId));
      if (existing >= MAX_SOUNDS_PER_SERVER) return null;
      const [row] = await tx.insert(serverSounds).values({
        id, serverId, uploaderId: userId, name, emoji, volume, size: buffer.length, durationMs: wav.durationMs,
      }).returning();
      await recordServerAudit(tx, { serverId, actorId: userId, action: 'sound.create', targetType: 'sound', targetId: id, targetLabel: name, changes: createdFields({ name, emoji }) });
      return row!;
    });
  } catch (err) {
    await fs.unlink(filePathFor(id)).catch(() => {});
    throw err;
  }
  if (!inserted) {
    await fs.unlink(filePathFor(id)).catch(() => {});
    return sendError(reply, 409, 'soundboard_full', `O servidor já tem ${MAX_SOUNDS_PER_SERVER} sons.`);
  }

  const [uploader] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  notifyChanged(serverId);
  sendJson(reply, 201, { sound: toEntry(inserted, uploader ?? null) });
}

async function findSound(serverId: string, soundId: string): Promise<ServerSound | null> {
  const [row] = await db.select().from(serverSounds)
    .where(and(eq(serverSounds.id, soundId), eq(serverSounds.serverId, serverId)))
    .limit(1);
  return row ?? null;
}

async function handleUpdate(request: FastifyRequest<SoundParams>, reply: FastifyReply): Promise<void> {
  const userId = await sessionUserId(request);
  if (!userId) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');
  const { serverId, soundId } = request.params;
  const access = await soundboardAccess(serverId, userId);
  if (!access) return sendError(reply, 404, 'not_found', 'Servidor não encontrado.');
  const sound = await findSound(serverId, soundId);
  if (!sound) return sendError(reply, 404, 'not_found', 'Som não encontrado.');
  if (!canEditSound(sound, userId, access.permissions)) return sendError(reply, 403, 'forbidden', 'Só quem enviou o som ou quem gerencia expressões pode editá-lo.');

  const body = jsonBody(request.body);
  const updates: Partial<Pick<ServerSound, 'name' | 'emoji' | 'volume'>> = {};
  if (body.name !== undefined) {
    const name = sanitizeSoundName(body.name);
    if (!name) return sendError(reply, 400, 'invalid_request', 'Dê um nome ao som.');
    updates.name = name;
  }
  if (body.emoji !== undefined) {
    const emoji = sanitizeSoundEmoji(body.emoji);
    if (emoji === null) return sendError(reply, 400, 'invalid_request', 'Emoji inválido.');
    updates.emoji = emoji;
  }
  if (body.volume !== undefined) {
    const volume = sanitizeSoundVolume(body.volume);
    if (volume === null) return sendError(reply, 400, 'invalid_request', 'Volume inválido.');
    updates.volume = volume;
  }
  if (!Object.keys(updates).length) return sendError(reply, 400, 'invalid_request', 'Nada para alterar.');

  const changes = diffFields(sound, updates, ['name', 'emoji', 'volume']);
  const row = await db.transaction(async (tx) => {
    const [updated] = await tx.update(serverSounds).set(updates).where(eq(serverSounds.id, sound.id)).returning();
    if (updated && changes.length) {
      await recordServerAudit(tx, { serverId, actorId: userId, action: 'sound.update', targetType: 'sound', targetId: sound.id, targetLabel: updated.name, changes });
    }
    return updated;
  });
  if (!row) return sendError(reply, 404, 'not_found', 'Som não encontrado.');
  const [uploader] = row.uploaderId ? await db.select().from(users).where(eq(users.id, row.uploaderId)).limit(1) : [];
  notifyChanged(serverId);
  sendJson(reply, 200, { sound: toEntry(row, uploader ?? null) });
}

async function handleDelete(request: FastifyRequest<SoundParams>, reply: FastifyReply): Promise<void> {
  const userId = await sessionUserId(request);
  if (!userId) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');
  const { serverId, soundId } = request.params;
  const access = await soundboardAccess(serverId, userId);
  if (!access) return sendError(reply, 404, 'not_found', 'Servidor não encontrado.');
  const sound = await findSound(serverId, soundId);
  if (!sound) return sendError(reply, 404, 'not_found', 'Som não encontrado.');
  if (!canEditSound(sound, userId, access.permissions)) return sendError(reply, 403, 'forbidden', 'Só quem enviou o som ou quem gerencia expressões pode removê-lo.');

  const deleted = await db.transaction(async (tx) => {
    const rows = await tx.delete(serverSounds).where(eq(serverSounds.id, sound.id)).returning({ id: serverSounds.id });
    if (rows.length) {
      await recordServerAudit(tx, { serverId, actorId: userId, action: 'sound.delete', targetType: 'sound', targetId: sound.id, targetLabel: sound.name, extra: { uploaderId: sound.uploaderId } });
    }
    return rows;
  });
  if (deleted.length) {
    await fs.unlink(filePathFor(sound.id)).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') log.warn('failed to delete sound file', { soundId: sound.id, err: err.message });
    });
    notifyChanged(serverId);
  }
  reply.code(204).send();
}

/** Members only, revalidated on every use like a chat attachment: the ETag is
 * the immutable sound id, and the 304 only comes after the membership check. */
async function handleFile(request: FastifyRequest<SoundParams>, reply: FastifyReply): Promise<void> {
  const userId = await sessionUserId(request);
  if (!userId) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');
  const { serverId, soundId } = request.params;
  if (!(await soundboardAccess(serverId, userId))) return sendError(reply, 404, 'not_found', 'Servidor não encontrado.');
  const sound = await findSound(serverId, soundId);
  if (!sound) return sendError(reply, 404, 'not_found', 'Som não encontrado.');

  const etag = `"${sound.id}"`;
  reply.header('Cache-Control', 'private, no-cache').header('ETag', etag).header('X-Content-Type-Options', 'nosniff');
  if ((request.headers['if-none-match'] ?? '').split(',').map((v) => v.trim().replace(/^W\//, '')).includes(etag)) {
    reply.code(304).send();
    return;
  }
  let buffer: Buffer;
  try {
    buffer = await fs.readFile(filePathFor(sound.id));
  } catch {
    return sendError(reply, 404, 'not_found', 'Som não encontrado.');
  }
  reply.code(200).header('Content-Type', 'audio/wav').send(buffer);
}

/** Plays one of the server's sounds for everyone in the same voice channel.
 * Each client fetches and plays the file itself — nothing is mixed into
 * anyone's microphone. */
async function handlePlay(socket: AppSocket, msg: { conversationId?: string; soundId?: string }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  const conversationId = String(msg.conversationId || '');
  const soundId = String(msg.soundId || '');
  if (!conversationId || !soundId || p.callConversationId !== conversationId) return;
  const [channel] = await db.select({ serverId: conversations.serverId }).from(conversations).where(eq(conversations.id, conversationId)).limit(1);
  if (!channel?.serverId) return;
  const sound = await findSound(channel.serverId, soundId);
  if (!sound) return;
  // removal from the server cuts the call too, but not in the same instant
  const snapshot = await loadServerSnapshot(channel.serverId);
  if (!snapshot || !hasPermission(channelPermissionsIn(snapshot, conversationId, p.userId), PERMISSIONS.USE_SOUNDBOARD)) return;
  const event = { t: 'soundboard-play', conversationId, serverId: channel.serverId, soundId, participantId: p.id, emoji: sound.emoji, volume: sound.volume };
  for (const other of participants.values()) {
    if (other.callConversationId === conversationId) send(other.socket, event);
  }
}

export const handlers: HandlerTable = {
  'soundboard-play': handlePlay,
};

export function registerSoundboardRoutes(fastify: FastifyInstance): void {
  fastify.get('/api/servers/:serverId/sounds', handleList);
  fastify.patch('/api/servers/:serverId/sounds/:soundId', handleUpdate);
  fastify.delete('/api/servers/:serverId/sounds/:soundId', handleDelete);
  fastify.get('/api/servers/:serverId/sounds/:soundId/file', handleFile);
  // raw Buffer body, scoped so the wildcard parser doesn't reach the JSON routes
  fastify.register(async (scoped) => {
    scoped.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, payload, done) => done(null, payload));
    scoped.post('/api/servers/:serverId/sounds', { bodyLimit: MAX_SOUND_BYTES }, handleUpload);
  });
}
