import { eq, and, lt, desc, sql, inArray, notInArray, ilike } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../../config/env.js';
import { db } from '../../db/client.js';
import { messages, conversations, conversationMembers, users, attachments as attachmentsTable } from '../../db/schema.js';
import { sendJson, sendError } from '../../http/respond.js';
import { parseCookies } from '../../http/cookies.js';
import { resolveSession } from '../auth/session.js';
import { resolveDisplayName } from '../users/users.js';
import { firstEmbed, type DetectedEmbed } from '../link-preview/embeds.js';
import { escapeLike } from '../friendships/cursor.js';

// GET /api/media — the per-conversation "Mídias e links" panel: aggregates
// every uploaded attachment and every embeddable link, newest first. One list
// per ?kind (see MEDIA_KINDS), each cursor-paginated (?before=<msgId>,
// exclusive) instead of offset — a cursor can't skip or repeat an item if a
// new message arrives between two "load more" clicks. An optional
// ?conversationId narrows to a single DM/group; omitted, it aggregates
// across every conversation the user is in (same shape, just unfiltered).
//
// The upload kinds (uploads, images, videos, audios, documents) are one exact
// query each (the attachments innerJoin already filters to
// message-with-attachment; the type is a filter on the mime). A type is
// filtered here, not in the client, so a sparse tab does not sit empty while
// its few items hide behind many pages of the others. ?q narrows them by file
// name (and links by their text). gifs are the messages that are nothing but a
// KLIPY URL, one exact query on the text. embeds must scan message TEXT in JS (mirrors
// web/src/shared/lib/chatEmbeds.ts) since not every link becomes an embed —
// the SQL filter (~* 'https?://') only narrows candidates; fetchEmbedsPage
// scans in batches until it collects `limit` real embeds or the table runs out.
//
// Both queries innerJoin conversationMembers on the REQUESTING user — this
// is the privacy boundary: without it, someone's Media tab would surface
// every other user's DMs/groups too, not just their own.

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 60;
const MAX_QUERY_LENGTH = 100;
const EMBED_BATCH_SIZE = 40;
// cap on rows scanned per call, even without reaching `limit` embeds —
// avoids an expensive loop if a conversation has hundreds of non-embed links.
// "Load more" resumes exactly from the cursor (see nextBefore).
const EMBED_SCAN_CEILING = 400;
// messages.id is a 4-byte `serial` — using Number.MAX_SAFE_INTEGER as the
// "no cursor yet" sentinel overflows Postgres's int4 range. This is the
// column's real ceiling.
const PG_INT4_MAX = 2147483647;
const DELETED_AUTHOR_NAME = 'Usuário apagado';

export const MEDIA_KINDS = ['uploads', 'images', 'videos', 'audios', 'documents', 'gifs', 'embeds'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];
type UploadKind = 'uploads' | 'images' | 'videos' | 'audios' | 'documents';

// Mirror web/src/features/chat/ChatAttachment.tsx: what the chat renders
// inline as an image, video or audio player. Everything else is a document.
const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const VIDEO_MIMES = ['video/mp4', 'video/webm', 'video/ogg'];
const AUDIO_MIMES = ['audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/mp4'];
// Mirrors web/src/features/gifs/klipyMedia.ts: a message whose whole text is
// one KLIPY media URL. Postgres' ARE syntax understands \s and \S.
const GIF_TEXT_RE = '^\\s*https://static[0-9]*\\.klipy\\.com/\\S+\\s*$';

function mimeFilter(kind: UploadKind) {
  switch (kind) {
    case 'images': return inArray(attachmentsTable.mimeType, IMAGE_MIMES);
    case 'videos': return inArray(attachmentsTable.mimeType, VIDEO_MIMES);
    case 'audios': return inArray(attachmentsTable.mimeType, AUDIO_MIMES);
    case 'documents': return notInArray(attachmentsTable.mimeType, [...IMAGE_MIMES, ...VIDEO_MIMES, ...AUDIO_MIMES]);
    case 'uploads': return undefined;
  }
}

const likePattern = (q: string | null) => (q ? `%${escapeLike(q)}%` : null);

const otherMembers = alias(conversationMembers, 'other_members');
const otherUsers = alias(users, 'other_users');

interface MediaBaseRow {
  msgId: number;
  conversationId: string;
  conversationType: string;
  conversationTitle: string;
  otherDisplayName: string | null;
  otherUsername: string | null;
  authorId: string | null;
  authorUsername: string | null;
  authorDisplayName: string | null;
  authorAvatar: string | null;
  authorAvatarColor: string | null;
  createdAt: Date;
}

interface MediaBase {
  msgId: number;
  conversationId: string;
  conversationName: string;
  authorId: string | null;
  authorName: string;
  authorAvatar: string;
  authorAvatarColor: string;
  ts: number;
}

interface MediaPage<T> {
  items: T[];
  nextBefore: number | null;
}

interface UploadItem extends MediaBase {
  attachment: { id: string; name: string; mime: string; size: number; thumbId?: string; width?: number; height?: number; placeholder?: string };
}

interface EmbedItem extends MediaBase {
  embed: DetectedEmbed;
}

function conversationNameFor(row: MediaBaseRow): string {
  if (row.conversationType === 'group') return row.conversationTitle || 'Grupo';
  return row.otherUsername ? resolveDisplayName(row.otherDisplayName ?? '', row.otherUsername) : 'Conversa direta';
}

function toMediaBase(row: MediaBaseRow): MediaBase {
  return {
    msgId: row.msgId,
    conversationId: row.conversationId,
    conversationName: conversationNameFor(row),
    authorId: row.authorId,
    authorName: row.authorUsername
      ? resolveDisplayName(row.authorDisplayName ?? '', row.authorUsername)
      : DELETED_AUTHOR_NAME,
    authorAvatar: row.authorAvatar ?? '',
    authorAvatarColor: row.authorAvatarColor ?? '',
    ts: row.createdAt.getTime(),
  };
}

async function fetchUploadsPage(kind: UploadKind, viewerId: string, before: number | null, limit: number, conversationId: string | null, q: string | null): Promise<MediaPage<UploadItem>> {
  const pattern = likePattern(q);
  const rows = await db
    .select({
      msgId: messages.id,
      conversationId: messages.conversationId,
      conversationType: conversations.type,
      conversationTitle: conversations.title,
      otherDisplayName: otherUsers.displayName,
      otherUsername: otherUsers.username,
      authorId: messages.authorId,
      authorUsername: users.username,
      authorDisplayName: users.displayName,
      authorAvatar: users.avatar,
      authorAvatarColor: users.avatarColor,
      createdAt: messages.createdAt,
      attachmentId: attachmentsTable.id,
      fileName: attachmentsTable.fileName,
      mimeType: attachmentsTable.mimeType,
      size: attachmentsTable.size,
      thumbId: attachmentsTable.thumbId,
      width: attachmentsTable.width,
      height: attachmentsTable.height,
      placeholder: attachmentsTable.placeholder,
    })
    .from(messages)
    // innerJoin (not left) on attachments.message_id=messages.id already
    // filters to message-with-attachment — avatars (message_id NULL) never
    // match, no extra filter needed.
    .innerJoin(attachmentsTable, eq(attachmentsTable.messageId, messages.id))
    // innerJoin on the REQUESTING user is the privacy boundary — it stays
    // even when conversationId narrows the scope, so passing someone else's
    // conversationId (one the viewer isn't a member of) yields zero rows
    // instead of leaking that conversation's media.
    .innerJoin(conversationMembers, and(eq(conversationMembers.conversationId, messages.conversationId), eq(conversationMembers.userId, viewerId)))
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .leftJoin(otherMembers, and(
      eq(otherMembers.conversationId, messages.conversationId),
      eq(conversations.type, 'direct'),
      sql`${otherMembers.userId} <> ${viewerId}`,
    ))
    .leftJoin(otherUsers, eq(otherUsers.id, otherMembers.userId))
    .leftJoin(users, eq(users.id, messages.authorId))
    .where(and(
      lt(messages.id, before ?? PG_INT4_MAX),
      conversationId ? eq(messages.conversationId, conversationId) : undefined,
      // thumbnail rows share their parent's messageId on purpose (see
      // schema.ts) — without this they'd show up as a second, duplicate item.
      eq(attachmentsTable.isThumbnail, false),
      mimeFilter(kind),
      pattern ? ilike(attachmentsTable.fileName, pattern) : undefined,
    ))
    .orderBy(desc(messages.id))
    .limit(limit);

  const items: UploadItem[] = rows.map((row) => ({
    ...toMediaBase(row),
    attachment: {
      id: row.attachmentId, name: row.fileName, mime: row.mimeType, size: row.size,
      ...(row.thumbId ? { thumbId: row.thumbId } : {}),
      ...(row.width && row.height ? { width: row.width, height: row.height } : {}),
      ...(row.placeholder ? { placeholder: row.placeholder } : {}),
    },
  }));
  return { items, nextBefore: rows.length === limit ? rows[rows.length - 1]!.msgId : null };
}

/** links: messages with an embeddable link, GIF messages left out (they have
 * their own list). gifs: the messages that are only a GIF URL. */
async function fetchEmbedsPage(mode: 'links' | 'gifs', viewerId: string, before: number | null, limit: number, conversationId: string | null, q: string | null): Promise<MediaPage<EmbedItem>> {
  const pattern = likePattern(q);
  const items: EmbedItem[] = [];
  let cursor = before ?? null;
  let exhausted = false;
  let scanned = 0;

  while (items.length < limit && scanned < EMBED_SCAN_CEILING) {
    const batch = await db
      .select({
        msgId: messages.id,
        conversationId: messages.conversationId,
        conversationType: conversations.type,
        conversationTitle: conversations.title,
        otherDisplayName: otherUsers.displayName,
        otherUsername: otherUsers.username,
        authorId: messages.authorId,
        authorUsername: users.username,
        authorDisplayName: users.displayName,
        authorAvatar: users.avatar,
        authorAvatarColor: users.avatarColor,
        createdAt: messages.createdAt,
        text: messages.text,
      })
      .from(messages)
      .innerJoin(conversationMembers, and(eq(conversationMembers.conversationId, messages.conversationId), eq(conversationMembers.userId, viewerId)))
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .leftJoin(otherMembers, and(
        eq(otherMembers.conversationId, messages.conversationId),
        eq(conversations.type, 'direct'),
        sql`${otherMembers.userId} <> ${viewerId}`,
      ))
      .leftJoin(otherUsers, eq(otherUsers.id, otherMembers.userId))
      .leftJoin(users, eq(users.id, messages.authorId))
      .where(and(
        lt(messages.id, cursor ?? PG_INT4_MAX),
        mode === 'gifs'
          ? sql`${messages.text} ~* ${GIF_TEXT_RE}`
          : and(sql`${messages.text} ~* ${'https?://'}`, sql`${messages.text} !~* ${GIF_TEXT_RE}`),
        pattern ? ilike(messages.text, pattern) : undefined,
        conversationId ? eq(messages.conversationId, conversationId) : undefined,
      ))
      .orderBy(desc(messages.id))
      .limit(EMBED_BATCH_SIZE);

    if (batch.length === 0) { exhausted = true; break; }
    scanned += batch.length;

    // if `limit` is hit MID-BATCH, we stop consuming it without knowing if
    // more candidates existed past that point — so a short batch here does
    // NOT by itself mean "end of table" (it's short because we gave up
    // early, not because the rows ran out).
    let stoppedEarly = false;
    for (const row of batch) {
      // cursor ALWAYS advances, even when a candidate doesn't become an
      // embed — this is what lets the next call ("load more" again) resume
      // exactly here, without re-scanning or skipping anything.
      cursor = row.msgId;
      const embed: DetectedEmbed | null = mode === 'gifs' ? { kind: 'image', url: row.text.trim() } : firstEmbed(row.text);
      if (embed) {
        items.push({ ...toMediaBase(row), embed });
        if (items.length >= limit) { stoppedEarly = true; break; }
      }
    }
    // only here, with the FULL batch consumed, does a short batch actually
    // mean the table ran out.
    if (!stoppedEarly && batch.length < EMBED_BATCH_SIZE) { exhausted = true; break; }
  }

  return { items, nextBefore: exhausted ? null : cursor };
}

export function fetchMediaPage(kind: MediaKind, viewerId: string, before: number | null, limit: number, conversationId: string | null, q: string | null): Promise<MediaPage<UploadItem> | MediaPage<EmbedItem>> {
  if (kind === 'embeds') return fetchEmbedsPage('links', viewerId, before, limit, conversationId, q);
  if (kind === 'gifs') return fetchEmbedsPage('gifs', viewerId, before, limit, conversationId, q);
  return fetchUploadsPage(kind, viewerId, before, limit, conversationId, q);
}

async function handleMedia(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const cookies = parseCookies(request.headers.cookie || '');
  const sess = await resolveSession(cookies[config.SESSION_COOKIE]);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');

  const query = request.query as Record<string, string | undefined>;
  const kind: MediaKind = MEDIA_KINDS.find((k) => k === query.kind) ?? 'uploads';
  const beforeRaw = query.before;
  const before = beforeRaw && /^\d+$/.test(beforeRaw) ? Number(beforeRaw) : null;
  const limitRaw = Number(query.limit);
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : DEFAULT_LIMIT, 1), MAX_LIMIT);
  const conversationId = query.conversationId || null;
  const q = query.q?.trim().slice(0, MAX_QUERY_LENGTH) || null;

  sendJson(reply, 200, await fetchMediaPage(kind, sess.userId, before, limit, conversationId, q));
}

export function registerMediaRoutes(fastify: FastifyInstance): void {
  fastify.get('/api/media', handleMedia);
}
