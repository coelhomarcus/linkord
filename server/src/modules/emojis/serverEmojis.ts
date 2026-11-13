import fs from 'node:fs/promises';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, asc, count, eq, inArray } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { serverEmojis, serverMembers, servers, users, type ServerEmoji, type User } from '../../db/schema.js';
import { jsonBody, sendError, sendJson } from '../../http/respond.js';
import { newId, filePathFor } from '../attachments/attachmentStorage.js';
import { hasRoomFor } from '../attachments/attachmentQuota.js';
import { hasPermission, PERMISSIONS } from '../servers/permissions.js';
import { requireServerMember, requireSession } from '../servers/serverHttp.js';
import { broadcastToServerMembers } from '../servers/serverSummaries.js';
import { createdFields, diffFields, recordServerAudit } from '../servers/serverAuditLog.js';
import { toSocialUser, type SocialUser } from '../users/users.js';
import * as floodControl from '../../realtime/floodControl.js';
import { encodeEmoji, MAX_EMOJI_UPLOAD_BYTES } from './emojiFile.js';
import { parseCropParam } from '../attachments/imageCrop.js';
import { customEmojiIds, rewriteCustomEmojis } from './customEmojiTokens.js';
import { logger } from '../../lib/logger.js';

const log = logger.child({ component: 'server-emojis' });

// Discord's base tier: static and animated slots are counted apart
const MAX_STATIC_EMOJIS = 50;
const MAX_ANIMATED_EMOJIS = 50;
const EMOJI_UPLOAD_LIMIT = { windowMs: 60_000, max: 10 };
const NAME_RE = /^[a-z0-9_]{2,32}$/;

/** What a name field means, or null when it can't be one: lowercase,
 * [a-z0-9_], 2 to 32 characters, nothing quietly changed. */
export function parseEmojiName(value: unknown): string | null {
  const name = typeof value === 'string' ? value.trim() : '';
  return NAME_RE.test(name) ? name : null;
}

interface EmojiEntry {
  id: string;
  name: string;
  animated: boolean;
  createdAt: number;
  uploader: SocialUser | null;
}

/** What every member's client keeps: enough to show and send it. */
export interface EmojiSummary {
  id: string;
  name: string;
  animated: boolean;
}

function toEntry(row: ServerEmoji, uploader: User | null): EmojiEntry {
  return { id: row.id, name: row.name, animated: row.animated, createdAt: row.createdAt.getTime(), uploader: uploader ? toSocialUser(uploader) : null };
}

const limits = { static: MAX_STATIC_EMOJIS, animated: MAX_ANIMATED_EMOJIS };

/** The uploader edits and removes their own emojis; MANAGE_EXPRESSIONS, any of them. */
function canEditEmoji(emoji: ServerEmoji, userId: string, permissions: number): boolean {
  return emoji.uploaderId === userId || hasPermission(permissions, PERMISSIONS.MANAGE_EXPRESSIONS);
}

function notifyChanged(serverId: string): void {
  broadcastToServerMembers(serverId, { t: 'server-emojis-changed', serverId }).catch((err) => {
    log.error('failed to broadcast emoji change', err, { serverId });
  });
}

async function findEmoji(serverId: string, emojiId: string): Promise<ServerEmoji | null> {
  const [row] = await db.select().from(serverEmojis)
    .where(and(eq(serverEmojis.id, emojiId), eq(serverEmojis.serverId, serverId)))
    .limit(1);
  return row ?? null;
}

/** Emojis whose id is in `ids` and whose server `userId` is an active member
 * of: what that account may put in a message or a reaction. */
export async function usableEmojis(userId: string, ids: string[]): Promise<Map<string, EmojiSummary>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map();
  const rows = await db.select({ id: serverEmojis.id, name: serverEmojis.name, animated: serverEmojis.animated })
    .from(serverEmojis)
    .innerJoin(servers, eq(servers.id, serverEmojis.serverId))
    .innerJoin(serverMembers, and(eq(serverMembers.serverId, serverEmojis.serverId), eq(serverMembers.userId, userId)))
    .where(and(inArray(serverEmojis.id, unique), eq(servers.status, 'active')));
  return new Map(rows.map((row) => [row.id, row]));
}

/** The text as it should be stored when `userId` sends it: the server
 * emojis they may use kept as tokens, any other as its `:name:`. */
export async function sanitizeCustomEmojis(text: string, userId: string): Promise<string> {
  const ids = customEmojiIds(text);
  if (!ids.length) return text;
  return rewriteCustomEmojis(text, await usableEmojis(userId, ids));
}

type ServerParams = { Params: { serverId: string } };
type EmojiParams = { Params: { serverId: string; emojiId: string } };

async function handleList(request: FastifyRequest<ServerParams>, reply: FastifyReply): Promise<void> {
  const actor = await requireServerMember(request, reply, request.params.serverId);
  if (!actor) return;
  const rows = await db.select({ emoji: serverEmojis, uploader: users })
    .from(serverEmojis)
    .leftJoin(users, eq(users.id, serverEmojis.uploaderId))
    .where(eq(serverEmojis.serverId, request.params.serverId))
    .orderBy(asc(serverEmojis.createdAt), asc(serverEmojis.id));
  sendJson(reply, 200, { emojis: rows.map((r) => toEntry(r.emoji, r.uploader)), limits });
}

/** `GET /api/me/emojis` — every emoji the account can use: those of each
 * server it belongs to, grouped by server in the order of the account's server rail. */
async function handleMine(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const sess = await requireSession(request, reply);
  if (!sess) return;
  const rows = await db.select({ serverId: serverEmojis.serverId, id: serverEmojis.id, name: serverEmojis.name, animated: serverEmojis.animated })
    .from(serverMembers)
    .innerJoin(servers, eq(servers.id, serverMembers.serverId))
    .innerJoin(serverEmojis, eq(serverEmojis.serverId, serverMembers.serverId))
    .where(and(eq(serverMembers.userId, sess.userId), eq(servers.status, 'active')))
    .orderBy(asc(serverMembers.position), asc(serverMembers.joinedAt), asc(serverEmojis.createdAt), asc(serverEmojis.id));
  const byServer = new Map<string, EmojiSummary[]>();
  for (const { serverId, ...emoji } of rows) {
    let list = byServer.get(serverId);
    if (!list) { list = []; byServer.set(serverId, list); }
    list.push(emoji);
  }
  sendJson(reply, 200, { servers: [...byServer].map(([serverId, emojis]) => ({ serverId, emojis })) });
}

/** Raw image body, the original file; the name and the crop
 * (`x,y,width,height`) ride in the query string. */
async function handleUpload(request: FastifyRequest<ServerParams & { Querystring: { name?: string; crop?: string } }>, reply: FastifyReply): Promise<void> {
  const serverId = request.params.serverId;
  // an emoji takes one of the server's slots for everyone, like a sound
  const actor = await requireServerMember(request, reply, serverId, PERMISSIONS.CREATE_EXPRESSIONS);
  if (!actor) return;
  const userId = actor.userId;
  if (!floodControl.allow(`emoji-upload:${userId}`, EMOJI_UPLOAD_LIMIT)) {
    return sendError(reply, 429, 'rate_limited', 'Muitos emojis enviados em pouco tempo. Tente de novo em instantes.');
  }
  const name = parseEmojiName(request.query.name);
  if (!name) return sendError(reply, 400, 'invalid_emoji_name', 'O nome precisa ter de 2 a 32 letras minúsculas, números ou _.');

  const buffer = request.body as Buffer;
  if (!buffer || buffer.length === 0) return sendError(reply, 400, 'empty_file', 'Arquivo vazio.');
  const crop = parseCropParam(request.query.crop);
  if (request.query.crop !== undefined && !crop) return sendError(reply, 400, 'invalid_crop', 'Recorte inválido.');
  const encoded = await encodeEmoji(buffer, crop);
  if (encoded === 'invalid_crop') return sendError(reply, 400, 'invalid_crop', 'Recorte fora dos limites da imagem.');
  if (encoded === 'invalid_image') return sendError(reply, 400, 'invalid_image', 'Não foi possível ler essa imagem.');
  if (encoded === 'emoji_too_large') return sendError(reply, 400, 'emoji_too_large', 'Esse emoji fica pesado demais. Tente uma animação mais curta.');

  if (!(await hasRoomFor(encoded.data.length))) {
    log.warn('emoji upload refused: instance storage is full', { userId, size: encoded.data.length });
    return sendError(reply, 400, 'storage_full', 'Armazenamento cheio. Tente novamente mais tarde.');
  }

  const id = newId();
  await fs.writeFile(filePathFor(id), encoded.data);
  let outcome: ServerEmoji | 'full' | 'name_taken';
  try {
    // the server row lock serializes concurrent uploads: two can't both take the last slot
    outcome = await db.transaction(async (tx) => {
      await tx.select({ id: servers.id }).from(servers).where(eq(servers.id, serverId)).for('update');
      const [{ value: existing } = { value: 0 }] = await tx.select({ value: count() }).from(serverEmojis)
        .where(and(eq(serverEmojis.serverId, serverId), eq(serverEmojis.animated, encoded.animated)));
      if (existing >= (encoded.animated ? MAX_ANIMATED_EMOJIS : MAX_STATIC_EMOJIS)) return 'full' as const;
      const [taken] = await tx.select({ id: serverEmojis.id }).from(serverEmojis).where(and(eq(serverEmojis.serverId, serverId), eq(serverEmojis.name, name))).limit(1);
      if (taken) return 'name_taken' as const;
      const [row] = await tx.insert(serverEmojis).values({ id, serverId, uploaderId: userId, name, animated: encoded.animated, size: encoded.data.length }).returning();
      await recordServerAudit(tx, { serverId, actorId: userId, action: 'emoji.create', targetType: 'emoji', targetId: id, targetLabel: name, changes: createdFields({ name }) });
      return row!;
    });
  } catch (err) {
    await fs.unlink(filePathFor(id)).catch(() => {});
    throw err;
  }
  if (typeof outcome === 'string') {
    await fs.unlink(filePathFor(id)).catch(() => {});
    if (outcome === 'name_taken') return sendError(reply, 409, 'emoji_name_taken', 'Já existe um emoji com esse nome nesse servidor.');
    return sendError(reply, 409, 'emojis_full', encoded.animated
      ? `O servidor já tem ${MAX_ANIMATED_EMOJIS} emojis animados.`
      : `O servidor já tem ${MAX_STATIC_EMOJIS} emojis.`);
  }
  const [uploader] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  notifyChanged(serverId);
  sendJson(reply, 201, { emoji: toEntry(outcome, uploader ?? null) });
}

async function handleRename(request: FastifyRequest<EmojiParams>, reply: FastifyReply): Promise<void> {
  const { serverId, emojiId } = request.params;
  const actor = await requireServerMember(request, reply, serverId);
  if (!actor) return;
  const emoji = await findEmoji(serverId, emojiId);
  if (!emoji) return sendError(reply, 404, 'not_found', 'Emoji não encontrado.');
  if (!canEditEmoji(emoji, actor.userId, actor.permissions)) return sendError(reply, 403, 'forbidden', 'Só quem enviou o emoji ou quem gerencia expressões pode editá-lo.');
  const name = parseEmojiName(jsonBody(request.body).name);
  if (!name) return sendError(reply, 400, 'invalid_emoji_name', 'O nome precisa ter de 2 a 32 letras minúsculas, números ou _.');

  const changes = diffFields(emoji, { name }, ['name']);
  let row: ServerEmoji | undefined;
  try {
    row = await db.transaction(async (tx) => {
      const [updated] = await tx.update(serverEmojis).set({ name }).where(eq(serverEmojis.id, emoji.id)).returning();
      if (updated && changes.length) {
        await recordServerAudit(tx, { serverId, actorId: actor.userId, action: 'emoji.update', targetType: 'emoji', targetId: emoji.id, targetLabel: name, changes });
      }
      return updated;
    });
  } catch (err) {
    // drizzle wraps the driver's error: unique_violation is on its cause
    if ((err as { cause?: { code?: string } }).cause?.code === '23505') return sendError(reply, 409, 'emoji_name_taken', 'Já existe um emoji com esse nome nesse servidor.');
    throw err;
  }
  if (!row) return sendError(reply, 404, 'not_found', 'Emoji não encontrado.');
  const [uploader] = row.uploaderId ? await db.select().from(users).where(eq(users.id, row.uploaderId)).limit(1) : [];
  if (changes.length) notifyChanged(serverId);
  sendJson(reply, 200, { emoji: toEntry(row, uploader ?? null) });
}

async function handleDelete(request: FastifyRequest<EmojiParams>, reply: FastifyReply): Promise<void> {
  const { serverId, emojiId } = request.params;
  const actor = await requireServerMember(request, reply, serverId);
  if (!actor) return;
  const emoji = await findEmoji(serverId, emojiId);
  if (!emoji) return sendError(reply, 404, 'not_found', 'Emoji não encontrado.');
  if (!canEditEmoji(emoji, actor.userId, actor.permissions)) return sendError(reply, 403, 'forbidden', 'Só quem enviou o emoji ou quem gerencia expressões pode removê-lo.');
  const deleted = await db.transaction(async (tx) => {
    const rows = await tx.delete(serverEmojis).where(eq(serverEmojis.id, emoji.id)).returning({ id: serverEmojis.id });
    if (rows.length) {
      await recordServerAudit(tx, { serverId, actorId: actor.userId, action: 'emoji.delete', targetType: 'emoji', targetId: emoji.id, targetLabel: emoji.name, extra: { uploaderId: emoji.uploaderId } });
    }
    return rows;
  });
  if (deleted.length) {
    await fs.unlink(filePathFor(emoji.id)).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') log.warn('failed to delete emoji file', { emojiId: emoji.id, err: err.message });
    });
    notifyChanged(serverId);
  }
  reply.code(204).send();
}

const MAX_META_IDS = 50;

/** `GET /api/emojis/meta?ids=a,b` — the name of emojis seen somewhere (a
 * reaction, mostly) by someone who may not be in their server. Never which
 * server: that stays for its members, who already have it. Ids that no
 * longer exist are left out. */
async function handleMeta(request: FastifyRequest<{ Querystring: { ids?: string } }>, reply: FastifyReply): Promise<void> {
  const sess = await requireSession(request, reply);
  if (!sess) return;
  const ids = [...new Set(String(request.query.ids ?? '').split(','))].filter((id) => /^[0-9a-f]{32}$/.test(id)).slice(0, MAX_META_IDS);
  const rows = ids.length
    ? await db.select({ id: serverEmojis.id, name: serverEmojis.name, animated: serverEmojis.animated }).from(serverEmojis).where(inArray(serverEmojis.id, ids))
    : [];
  sendJson(reply, 200, { emojis: rows });
}

/** `GET /api/emojis/:emojiId` — open to any signed-in account, member or not:
 * a server's emoji shows up wherever its members use it (another server, a
 * DM), and whoever reads the message must see it. The id is random and
 * unguessable, and its file never changes, so it is cached for good. */
async function handleFile(request: FastifyRequest<{ Params: { emojiId: string } }>, reply: FastifyReply): Promise<void> {
  const sess = await requireSession(request, reply);
  if (!sess) return;
  const emojiId = String(request.params.emojiId || '');
  if (!/^[0-9a-f]{32}$/.test(emojiId)) return sendError(reply, 404, 'not_found', 'Emoji não encontrado.');
  const [emoji] = await db.select({ id: serverEmojis.id }).from(serverEmojis).where(eq(serverEmojis.id, emojiId)).limit(1);
  if (!emoji) return sendError(reply, 404, 'not_found', 'Emoji não encontrado.');
  let buffer: Buffer;
  try {
    buffer = await fs.readFile(filePathFor(emoji.id));
  } catch {
    return sendError(reply, 404, 'not_found', 'Emoji não encontrado.');
  }
  reply.code(200)
    .header('Content-Type', 'image/webp')
    .header('Cache-Control', 'private, max-age=31536000, immutable')
    .header('ETag', `"${emoji.id}"`)
    .header('X-Content-Type-Options', 'nosniff')
    .send(buffer);
}

export function registerServerEmojiRoutes(fastify: FastifyInstance): void {
  fastify.get('/api/me/emojis', handleMine);
  fastify.get('/api/emojis/meta', handleMeta);
  fastify.get('/api/emojis/:emojiId', handleFile);
  fastify.get('/api/servers/:serverId/emojis', handleList);
  fastify.patch('/api/servers/:serverId/emojis/:emojiId', handleRename);
  fastify.delete('/api/servers/:serverId/emojis/:emojiId', handleDelete);
  // raw Buffer body, scoped so the wildcard parser doesn't reach the JSON routes
  fastify.register(async (scoped) => {
    scoped.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, payload, done) => done(null, payload));
    scoped.post('/api/servers/:serverId/emojis', { bodyLimit: MAX_EMOJI_UPLOAD_BYTES }, handleUpload);
  });
}
