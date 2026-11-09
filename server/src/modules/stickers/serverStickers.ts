import fs from 'node:fs/promises';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import { config } from '../../config/env.js';
import { db } from '../../db/client.js';
import { serverMembers, servers, serverStickers, users, type ServerSticker, type User } from '../../db/schema.js';
import { jsonBody, sendError, sendJson } from '../../http/respond.js';
import { newId, filePathFor } from '../attachments/attachmentStorage.js';
import { getUsage } from '../attachments/attachmentQuota.js';
import { hasPermission, PERMISSIONS } from '../servers/permissions.js';
import { requireServerMember, requireSession } from '../servers/serverHttp.js';
import { broadcastToServerMembers } from '../servers/serverSummaries.js';
import { createdFields, diffFields, recordServerAudit } from '../servers/serverAuditLog.js';
import { toSocialUser, type SocialUser } from '../users/users.js';
import * as floodControl from '../../realtime/floodControl.js';
import { encodeSquareWebp } from '../emojis/emojiFile.js';
import { isSingleEmoji } from '../messages/emoji.js';
import { logger } from '../../lib/logger.js';

const log = logger.child({ component: 'server-stickers' });

// A sticker is a whole message, drawn large (Discord's stickers). Same rules
// as a server emoji: its server's members send it anywhere (another server,
// a DM), anyone who reads the message sees it.

export const STICKER_SIZE_PX = 320;
// the original picture, as picked: a GIF found online is often a few MB
export const MAX_STICKER_UPLOAD_BYTES = 12 * 1024 * 1024;
// what is stored, after the 320px WebP: past this a long animation is refused
const MAX_STICKER_FILE_BYTES = 1024 * 1024;
// no boosts here: one tier, more than Discord's base 5
export const MAX_STICKERS = 30;
const STICKER_UPLOAD_LIMIT = { windowMs: 60_000, max: 10 };
const NAME_MIN = 2;
const NAME_MAX = 30;
const DESCRIPTION_MAX = 100;
const ID_RE = /^[0-9a-f]{32}$/;

function singleLine(value: unknown): string {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** One line, 2 to 30 characters; null rather than a name quietly cut. */
export function parseStickerName(value: unknown): string | null {
  const name = singleLine(value);
  return name.length >= NAME_MIN && name.length <= NAME_MAX ? name : null;
}

/** One line, up to 100 characters ('' for none); null past that. */
export function parseStickerDescription(value: unknown): string | null {
  const description = singleLine(value);
  return description.length <= DESCRIPTION_MAX ? description : null;
}

/** Exactly one Unicode emoji, or null. */
export function parseStickerEmoji(value: unknown): string | null {
  const emoji = String(value == null ? '' : value).trim();
  return isSingleEmoji(emoji) ? emoji : null;
}

export function isStickerId(value: unknown): value is string {
  return typeof value === 'string' && ID_RE.test(value);
}

interface StickerEntry {
  id: string;
  name: string;
  description: string;
  emoji: string;
  animated: boolean;
  createdAt: number;
  uploader: SocialUser | null;
}

/** What the picker keeps for each sticker the account may send. */
export interface StickerSummary {
  id: string;
  name: string;
  description: string;
  emoji: string;
  animated: boolean;
}

/** What a message carries about its sticker: enough to draw it. Never which
 * server it is from, which stays for its members (they have it in their list). */
export interface StickerCard {
  id: string;
  name: string;
  description: string;
  animated: boolean;
}

function toEntry(row: ServerSticker, uploader: User | null): StickerEntry {
  return {
    id: row.id, name: row.name, description: row.description, emoji: row.emoji, animated: row.animated,
    createdAt: row.createdAt.getTime(), uploader: uploader ? toSocialUser(uploader) : null,
  };
}

/** The uploader edits and removes their own stickers; MANAGE_EXPRESSIONS, any of them. */
function canEditSticker(sticker: ServerSticker, userId: string, permissions: number): boolean {
  return sticker.uploaderId === userId || hasPermission(permissions, PERMISSIONS.MANAGE_EXPRESSIONS);
}

function notifyChanged(serverId: string): void {
  broadcastToServerMembers(serverId, { t: 'server-stickers-changed', serverId }).catch((err) => {
    log.error('failed to broadcast sticker change', err, { serverId });
  });
}

async function findSticker(serverId: string, stickerId: string): Promise<ServerSticker | null> {
  const [row] = await db.select().from(serverStickers)
    .where(and(eq(serverStickers.id, stickerId), eq(serverStickers.serverId, serverId)))
    .limit(1);
  return row ?? null;
}

function isNameTaken(err: unknown): boolean {
  // drizzle wraps the driver's error: unique_violation is on its cause
  return (err as { cause?: { code?: string } }).cause?.code === '23505';
}

/** The sticker `userId` may send, if `stickerId` is one of an active server
 * they are a member of. */
export async function usableSticker(userId: string, stickerId: string): Promise<StickerCard | null> {
  const [row] = await db.select({ id: serverStickers.id, name: serverStickers.name, description: serverStickers.description, animated: serverStickers.animated })
    .from(serverStickers)
    .innerJoin(servers, eq(servers.id, serverStickers.serverId))
    .innerJoin(serverMembers, and(eq(serverMembers.serverId, serverStickers.serverId), eq(serverMembers.userId, userId)))
    .where(and(eq(serverStickers.id, stickerId), eq(servers.status, 'active')))
    .limit(1);
  return row ?? null;
}

/** The cards of the stickers that still exist, for a page of messages. */
export async function loadStickerCards(ids: string[]): Promise<Map<string, StickerCard>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map();
  const rows = await db.select({ id: serverStickers.id, name: serverStickers.name, description: serverStickers.description, animated: serverStickers.animated })
    .from(serverStickers)
    .where(inArray(serverStickers.id, unique));
  return new Map(rows.map((row) => [row.id, row]));
}

type ServerParams = { Params: { serverId: string } };
type StickerParams = { Params: { serverId: string; stickerId: string } };

async function handleList(request: FastifyRequest<ServerParams>, reply: FastifyReply): Promise<void> {
  const actor = await requireServerMember(request, reply, request.params.serverId);
  if (!actor) return;
  const rows = await db.select({ sticker: serverStickers, uploader: users })
    .from(serverStickers)
    .leftJoin(users, eq(users.id, serverStickers.uploaderId))
    .where(eq(serverStickers.serverId, request.params.serverId))
    .orderBy(asc(serverStickers.createdAt), asc(serverStickers.id));
  sendJson(reply, 200, { stickers: rows.map((r) => toEntry(r.sticker, r.uploader)), limit: MAX_STICKERS });
}

/** `GET /api/me/stickers` — every sticker the account can send: those of each
 * server it belongs to, grouped by server in the order of its server rail. */
async function handleMine(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const sess = await requireSession(request, reply);
  if (!sess) return;
  const rows = await db.select({
    serverId: serverStickers.serverId, id: serverStickers.id, name: serverStickers.name,
    description: serverStickers.description, emoji: serverStickers.emoji, animated: serverStickers.animated,
  })
    .from(serverMembers)
    .innerJoin(servers, eq(servers.id, serverMembers.serverId))
    .innerJoin(serverStickers, eq(serverStickers.serverId, serverMembers.serverId))
    .where(and(eq(serverMembers.userId, sess.userId), eq(servers.status, 'active')))
    .orderBy(asc(serverMembers.position), asc(serverMembers.joinedAt), asc(serverStickers.createdAt), asc(serverStickers.id));
  const byServer = new Map<string, StickerSummary[]>();
  for (const { serverId, ...sticker } of rows) {
    let list = byServer.get(serverId);
    if (!list) { list = []; byServer.set(serverId, list); }
    list.push(sticker);
  }
  sendJson(reply, 200, { servers: [...byServer].map(([serverId, stickers]) => ({ serverId, stickers })) });
}

/** Raw image body, the original file; name, emoji and description ride in
 * the query string. Never cropped: the picture is fitted whole. */
async function handleUpload(
  request: FastifyRequest<ServerParams & { Querystring: { name?: string; emoji?: string; description?: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const serverId = request.params.serverId;
  // a sticker takes one of the server's slots for everyone, like an emoji
  const actor = await requireServerMember(request, reply, serverId, PERMISSIONS.CREATE_EXPRESSIONS);
  if (!actor) return;
  const userId = actor.userId;
  if (!floodControl.allow(`sticker-upload:${userId}`, STICKER_UPLOAD_LIMIT)) {
    return sendError(reply, 429, 'rate_limited', 'Muitas figurinhas enviadas em pouco tempo. Tente de novo em instantes.');
  }
  const name = parseStickerName(request.query.name);
  if (!name) return sendError(reply, 400, 'invalid_sticker_name', `O nome precisa ter de ${NAME_MIN} a ${NAME_MAX} caracteres.`);
  const emoji = parseStickerEmoji(request.query.emoji);
  if (!emoji) return sendError(reply, 400, 'invalid_sticker_emoji', 'Escolha um emoji relacionado.');
  const description = parseStickerDescription(request.query.description);
  if (description === null) return sendError(reply, 400, 'invalid_sticker_description', `A descrição passa de ${DESCRIPTION_MAX} caracteres.`);

  const buffer = request.body as Buffer;
  if (!buffer || buffer.length === 0) return sendError(reply, 400, 'empty_file', 'Arquivo vazio.');
  const encoded = await encodeSquareWebp(buffer, { size: STICKER_SIZE_PX, maxBytes: MAX_STICKER_FILE_BYTES });
  if (encoded === 'invalid_image' || encoded === 'invalid_crop') return sendError(reply, 400, 'invalid_image', 'Não foi possível ler essa imagem.');
  if (encoded === 'too_large') return sendError(reply, 400, 'sticker_too_large', 'Essa figurinha fica pesada demais. Tente uma animação mais curta.');

  const usage = await getUsage();
  if (usage.totalBytes + encoded.data.length > config.MAX_STORAGE_BYTES) {
    log.warn('sticker upload refused: instance storage is full', { userId, size: encoded.data.length });
    return sendError(reply, 400, 'storage_full', 'Armazenamento cheio. Tente novamente mais tarde.');
  }

  const id = newId();
  await fs.writeFile(filePathFor(id), encoded.data);
  let outcome: ServerSticker | 'full' | 'name_taken';
  try {
    // the server row lock serializes concurrent uploads: two can't both take the last slot
    outcome = await db.transaction(async (tx) => {
      await tx.select({ id: servers.id }).from(servers).where(eq(servers.id, serverId)).for('update');
      const [{ value: existing } = { value: 0 }] = await tx.select({ value: count() }).from(serverStickers).where(eq(serverStickers.serverId, serverId));
      if (existing >= MAX_STICKERS) return 'full' as const;
      const [taken] = await tx.select({ id: serverStickers.id }).from(serverStickers)
        .where(and(eq(serverStickers.serverId, serverId), sql`lower(${serverStickers.name}) = lower(${name})`)).limit(1);
      if (taken) return 'name_taken' as const;
      const [row] = await tx.insert(serverStickers)
        .values({ id, serverId, uploaderId: userId, name, description, emoji, animated: encoded.animated, size: encoded.data.length })
        .returning();
      await recordServerAudit(tx, {
        serverId, actorId: userId, action: 'sticker.create', targetType: 'sticker', targetId: id, targetLabel: name,
        changes: createdFields({ name, emoji, description }),
      });
      return row!;
    });
  } catch (err) {
    await fs.unlink(filePathFor(id)).catch(() => {});
    throw err;
  }
  if (typeof outcome === 'string') {
    await fs.unlink(filePathFor(id)).catch(() => {});
    if (outcome === 'name_taken') return sendError(reply, 409, 'sticker_name_taken', 'Já existe uma figurinha com esse nome nesse servidor.');
    return sendError(reply, 409, 'stickers_full', `O servidor já tem ${MAX_STICKERS} figurinhas.`);
  }
  const [uploader] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  notifyChanged(serverId);
  sendJson(reply, 201, { sticker: toEntry(outcome, uploader ?? null) });
}

/** JSON body with any of `name`, `emoji`, `description`. */
async function handleUpdate(request: FastifyRequest<StickerParams>, reply: FastifyReply): Promise<void> {
  const { serverId, stickerId } = request.params;
  const actor = await requireServerMember(request, reply, serverId);
  if (!actor) return;
  const sticker = await findSticker(serverId, stickerId);
  if (!sticker) return sendError(reply, 404, 'not_found', 'Figurinha não encontrada.');
  if (!canEditSticker(sticker, actor.userId, actor.permissions)) return sendError(reply, 403, 'forbidden', 'Só quem enviou a figurinha ou quem gerencia expressões pode editá-la.');
  const body = jsonBody(request.body);
  const updates: Partial<Pick<ServerSticker, 'name' | 'emoji' | 'description'>> = {};
  if (body.name !== undefined) {
    const name = parseStickerName(body.name);
    if (!name) return sendError(reply, 400, 'invalid_sticker_name', `O nome precisa ter de ${NAME_MIN} a ${NAME_MAX} caracteres.`);
    updates.name = name;
  }
  if (body.emoji !== undefined) {
    const emoji = parseStickerEmoji(body.emoji);
    if (!emoji) return sendError(reply, 400, 'invalid_sticker_emoji', 'Escolha um emoji relacionado.');
    updates.emoji = emoji;
  }
  if (body.description !== undefined) {
    const description = parseStickerDescription(body.description);
    if (description === null) return sendError(reply, 400, 'invalid_sticker_description', `A descrição passa de ${DESCRIPTION_MAX} caracteres.`);
    updates.description = description;
  }

  const changes = diffFields(sticker, updates, ['name', 'emoji', 'description']);
  let row: ServerSticker | undefined;
  try {
    row = await db.transaction(async (tx) => {
      if (!changes.length) return sticker;
      const [updated] = await tx.update(serverStickers).set(updates).where(eq(serverStickers.id, sticker.id)).returning();
      if (updated) {
        await recordServerAudit(tx, { serverId, actorId: actor.userId, action: 'sticker.update', targetType: 'sticker', targetId: sticker.id, targetLabel: updated.name, changes });
      }
      return updated;
    });
  } catch (err) {
    if (isNameTaken(err)) return sendError(reply, 409, 'sticker_name_taken', 'Já existe uma figurinha com esse nome nesse servidor.');
    throw err;
  }
  if (!row) return sendError(reply, 404, 'not_found', 'Figurinha não encontrada.');
  const [uploader] = row.uploaderId ? await db.select().from(users).where(eq(users.id, row.uploaderId)).limit(1) : [];
  if (changes.length) notifyChanged(serverId);
  sendJson(reply, 200, { sticker: toEntry(row, uploader ?? null) });
}

async function handleDelete(request: FastifyRequest<StickerParams>, reply: FastifyReply): Promise<void> {
  const { serverId, stickerId } = request.params;
  const actor = await requireServerMember(request, reply, serverId);
  if (!actor) return;
  const sticker = await findSticker(serverId, stickerId);
  if (!sticker) return sendError(reply, 404, 'not_found', 'Figurinha não encontrada.');
  if (!canEditSticker(sticker, actor.userId, actor.permissions)) return sendError(reply, 403, 'forbidden', 'Só quem enviou a figurinha ou quem gerencia expressões pode removê-la.');
  const deleted = await db.transaction(async (tx) => {
    const rows = await tx.delete(serverStickers).where(eq(serverStickers.id, sticker.id)).returning({ id: serverStickers.id });
    if (rows.length) {
      await recordServerAudit(tx, {
        serverId, actorId: actor.userId, action: 'sticker.delete', targetType: 'sticker', targetId: sticker.id, targetLabel: sticker.name,
        extra: { uploaderId: sticker.uploaderId },
      });
    }
    return rows;
  });
  if (deleted.length) {
    await fs.unlink(filePathFor(sticker.id)).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') log.warn('failed to delete sticker file', { stickerId: sticker.id, err: err.message });
    });
    notifyChanged(serverId);
  }
  reply.code(204).send();
}

/** `GET /api/stickers/:stickerId` — open to any signed-in account, member or
 * not: whoever reads a message must see its sticker. The id is random and
 * unguessable, and its file never changes, so it is cached for good. */
async function handleFile(request: FastifyRequest<{ Params: { stickerId: string } }>, reply: FastifyReply): Promise<void> {
  const sess = await requireSession(request, reply);
  if (!sess) return;
  const stickerId = String(request.params.stickerId || '');
  if (!isStickerId(stickerId)) return sendError(reply, 404, 'not_found', 'Figurinha não encontrada.');
  const [sticker] = await db.select({ id: serverStickers.id }).from(serverStickers).where(eq(serverStickers.id, stickerId)).limit(1);
  if (!sticker) return sendError(reply, 404, 'not_found', 'Figurinha não encontrada.');
  let buffer: Buffer;
  try {
    buffer = await fs.readFile(filePathFor(sticker.id));
  } catch {
    return sendError(reply, 404, 'not_found', 'Figurinha não encontrada.');
  }
  reply.code(200)
    .header('Content-Type', 'image/webp')
    .header('Cache-Control', 'private, max-age=31536000, immutable')
    .header('ETag', `"${sticker.id}"`)
    .header('X-Content-Type-Options', 'nosniff')
    .send(buffer);
}

export function registerServerStickerRoutes(fastify: FastifyInstance): void {
  fastify.get('/api/me/stickers', handleMine);
  fastify.get('/api/stickers/:stickerId', handleFile);
  fastify.get('/api/servers/:serverId/stickers', handleList);
  fastify.patch('/api/servers/:serverId/stickers/:stickerId', handleUpdate);
  fastify.delete('/api/servers/:serverId/stickers/:stickerId', handleDelete);
  // raw Buffer body, scoped so the wildcard parser doesn't reach the JSON routes
  fastify.register(async (scoped) => {
    scoped.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, payload, done) => done(null, payload));
    scoped.post('/api/servers/:serverId/stickers', { bodyLimit: MAX_STICKER_UPLOAD_BYTES }, handleUpload);
  });
}
