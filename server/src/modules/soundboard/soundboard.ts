import fs from 'node:fs/promises';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, asc, count, eq } from 'drizzle-orm';
import { config } from '../../config/env.js';
import { db } from '../../db/client.js';
import { conversations, groupSounds, users, type GroupSound, type User } from '../../db/schema.js';
import { jsonBody, sendError, sendJson } from '../../http/respond.js';
import { parseCookies } from '../../http/cookies.js';
import { resolveSession } from '../auth/session.js';
import { toSocialUser, type SocialUser } from '../users/users.js';
import { isSingleEmoji } from '../messages/emoji.js';
import { newId, filePathFor } from '../attachments/attachmentStorage.js';
import { getUsage } from '../attachments/attachmentQuota.js';
import { broadcastToConversationMembers, canManageGroup, getConversationForUser } from '../conversations/conversationsRepository.js';
import { participants, send } from '../presence/participants.js';
import * as floodControl from '../../realtime/floodControl.js';
import { parseWav } from './soundFile.js';
import { logger } from '../../lib/logger.js';
import type { AppSocket, HandlerTable } from '../../types.js';

const log = logger.child({ component: 'soundboard' });

export const MAX_SOUNDS_PER_GROUP = 24;
// a little over 5s so a clip trimmed to exactly 5s never trips on rounding
export const MAX_SOUND_DURATION_MS = 5200;
// 5.2s of 48kHz mono 16-bit PCM is ~500KB — the most the client ever produces
export const MAX_SOUND_BYTES = 512 * 1024;
export const MAX_SOUND_NAME_LEN = 32;

// generous for someone building a soundboard, not for a script filling disks
const SOUND_UPLOAD_LIMIT = { windowMs: 60_000, max: 10 };

export interface SoundEntry {
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

function toEntry(row: GroupSound, uploader: User | null): SoundEntry {
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

/** Only plain groups have a soundboard: a DM has no group to own it, and a bot
 * has no calls to play it in. Null when the viewer isn't an active member. */
async function soundboardGroupFor(conversationId: string, userId: string) {
  const conversation = await getConversationForUser(conversationId, userId);
  return conversation?.type === 'group' ? conversation : null;
}

async function listSounds(conversationId: string): Promise<SoundEntry[]> {
  const rows = await db.select({ sound: groupSounds, uploader: users })
    .from(groupSounds)
    .leftJoin(users, eq(users.id, groupSounds.uploaderId))
    .where(eq(groupSounds.conversationId, conversationId))
    .orderBy(asc(groupSounds.createdAt), asc(groupSounds.id));
  return rows.map((r) => toEntry(r.sound, r.uploader));
}

/** The uploader edits and removes their own sounds; the owner, any of them. */
async function canEditSound(sound: GroupSound, userId: string): Promise<boolean> {
  return sound.uploaderId === userId || canManageGroup(sound.conversationId, userId);
}

function notifyChanged(conversationId: string): void {
  broadcastToConversationMembers(conversationId, { t: 'group-sounds-changed', conversationId }).catch((err) => {
    log.error('failed to broadcast soundboard change', err, { conversationId });
  });
}

type GroupParams = { Params: { conversationId: string } };
type SoundParams = { Params: { conversationId: string; soundId: string } };

async function handleList(request: FastifyRequest<GroupParams>, reply: FastifyReply): Promise<void> {
  const userId = await sessionUserId(request);
  if (!userId) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');
  const conversationId = String(request.params.conversationId || '');
  if (!(await soundboardGroupFor(conversationId, userId))) return sendError(reply, 404, 'not_found', 'Grupo não encontrado.');
  sendJson(reply, 200, { sounds: await listSounds(conversationId), maxSounds: MAX_SOUNDS_PER_GROUP });
}

/** Raw WAV body; name/emoji/volume ride in the query string since the body
 * is the file itself (same shape as the avatar upload). */
async function handleUpload(
  request: FastifyRequest<GroupParams & { Querystring: { name?: string; emoji?: string; volume?: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const userId = await sessionUserId(request);
  if (!userId) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');
  const conversationId = String(request.params.conversationId || '');
  if (!(await soundboardGroupFor(conversationId, userId))) return sendError(reply, 404, 'not_found', 'Grupo não encontrado.');

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
  let inserted: GroupSound | null;
  try {
    // the group row lock serializes concurrent uploads, so two of them can't
    // both see 23 sounds and both insert the 24th
    inserted = await db.transaction(async (tx) => {
      await tx.select({ id: conversations.id }).from(conversations).where(eq(conversations.id, conversationId)).for('update');
      const [{ value: existing } = { value: 0 }] = await tx.select({ value: count() }).from(groupSounds).where(eq(groupSounds.conversationId, conversationId));
      if (existing >= MAX_SOUNDS_PER_GROUP) return null;
      const [row] = await tx.insert(groupSounds).values({
        id, conversationId, uploaderId: userId, name, emoji, volume, size: buffer.length, durationMs: wav.durationMs,
      }).returning();
      return row!;
    });
  } catch (err) {
    await fs.unlink(filePathFor(id)).catch(() => {});
    throw err;
  }
  if (!inserted) {
    await fs.unlink(filePathFor(id)).catch(() => {});
    return sendError(reply, 409, 'soundboard_full', `O grupo já tem ${MAX_SOUNDS_PER_GROUP} sons.`);
  }

  const [uploader] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  notifyChanged(conversationId);
  sendJson(reply, 201, { sound: toEntry(inserted, uploader ?? null) });
}

async function findSound(conversationId: string, soundId: string): Promise<GroupSound | null> {
  const [row] = await db.select().from(groupSounds)
    .where(and(eq(groupSounds.id, soundId), eq(groupSounds.conversationId, conversationId)))
    .limit(1);
  return row ?? null;
}

async function handleUpdate(request: FastifyRequest<SoundParams>, reply: FastifyReply): Promise<void> {
  const userId = await sessionUserId(request);
  if (!userId) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');
  const { conversationId, soundId } = request.params;
  if (!(await soundboardGroupFor(conversationId, userId))) return sendError(reply, 404, 'not_found', 'Grupo não encontrado.');
  const sound = await findSound(conversationId, soundId);
  if (!sound) return sendError(reply, 404, 'not_found', 'Som não encontrado.');
  if (!(await canEditSound(sound, userId))) return sendError(reply, 403, 'forbidden', 'Só quem enviou o som ou o dono do grupo pode editá-lo.');

  const body = jsonBody(request.body);
  const updates: Partial<Pick<GroupSound, 'name' | 'emoji' | 'volume'>> = {};
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

  const [row] = await db.update(groupSounds).set(updates).where(eq(groupSounds.id, sound.id)).returning();
  if (!row) return sendError(reply, 404, 'not_found', 'Som não encontrado.');
  const [uploader] = row.uploaderId ? await db.select().from(users).where(eq(users.id, row.uploaderId)).limit(1) : [];
  notifyChanged(conversationId);
  sendJson(reply, 200, { sound: toEntry(row, uploader ?? null) });
}

async function handleDelete(request: FastifyRequest<SoundParams>, reply: FastifyReply): Promise<void> {
  const userId = await sessionUserId(request);
  if (!userId) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');
  const { conversationId, soundId } = request.params;
  if (!(await soundboardGroupFor(conversationId, userId))) return sendError(reply, 404, 'not_found', 'Grupo não encontrado.');
  const sound = await findSound(conversationId, soundId);
  if (!sound) return sendError(reply, 404, 'not_found', 'Som não encontrado.');
  if (!(await canEditSound(sound, userId))) return sendError(reply, 403, 'forbidden', 'Só quem enviou o som ou o dono do grupo pode removê-lo.');

  const deleted = await db.delete(groupSounds).where(eq(groupSounds.id, sound.id)).returning({ id: groupSounds.id });
  if (deleted.length) {
    await fs.unlink(filePathFor(sound.id)).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') log.warn('failed to delete sound file', { soundId: sound.id, err: err.message });
    });
    notifyChanged(conversationId);
  }
  reply.code(204).send();
}

/** Members only, revalidated on every use like a chat attachment: the ETag is
 * the immutable sound id, and the 304 only comes after the membership check. */
async function handleFile(request: FastifyRequest<SoundParams>, reply: FastifyReply): Promise<void> {
  const userId = await sessionUserId(request);
  if (!userId) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');
  const { conversationId, soundId } = request.params;
  if (!(await soundboardGroupFor(conversationId, userId))) return sendError(reply, 404, 'not_found', 'Grupo não encontrado.');
  const sound = await findSound(conversationId, soundId);
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

/** Plays a sound for everyone in the same group call. Each client fetches and
 * plays the file itself — nothing is mixed into anyone's microphone. */
async function handlePlay(socket: AppSocket, msg: { conversationId?: string; soundId?: string }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  const conversationId = String(msg.conversationId || '');
  const soundId = String(msg.soundId || '');
  if (!conversationId || !soundId || p.callConversationId !== conversationId) return;
  const sound = await findSound(conversationId, soundId);
  if (!sound) return;
  // removal from the group cuts the call too, but not in the same instant
  if (!(await soundboardGroupFor(conversationId, p.userId))) return;
  const event = { t: 'soundboard-play', conversationId, soundId, participantId: p.id, emoji: sound.emoji, volume: sound.volume };
  for (const other of participants.values()) {
    if (other.callConversationId === conversationId) send(other.socket, event);
  }
}

export const handlers: HandlerTable = {
  'soundboard-play': handlePlay,
};

export function registerSoundboardRoutes(fastify: FastifyInstance): void {
  fastify.get('/api/groups/:conversationId/sounds', handleList);
  fastify.patch('/api/groups/:conversationId/sounds/:soundId', handleUpdate);
  fastify.delete('/api/groups/:conversationId/sounds/:soundId', handleDelete);
  fastify.get('/api/groups/:conversationId/sounds/:soundId/file', handleFile);
  // raw Buffer body, scoped so the wildcard parser doesn't reach the JSON routes
  fastify.register(async (scoped) => {
    scoped.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, payload, done) => done(null, payload));
    scoped.post('/api/groups/:conversationId/sounds', { bodyLimit: MAX_SOUND_BYTES }, handleUpload);
  });
}
