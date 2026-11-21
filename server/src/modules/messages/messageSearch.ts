import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { config } from '../../config/env.js';
import { db } from '../../db/client.js';
import { messages, users } from '../../db/schema.js';
import { messageSearchQueries } from '../../db/textSearch.js';
import { participants, send } from '../presence/participants.js';
import { conversationExistsForUser, visibleChannelIdsInServer } from '../conversations/conversationsRepository.js';
import type { AppSocket, HandlerTable } from '../../types.js';
import { messageWithAuthorSelect, serializeRows } from './messages.js';
import { CONTENT_KINDS, contentCondition, type ContentKind } from './messageContent.js';

// The header search (protocol 26): full text plus Discord's filters, inside
// one server (its channels the account can see) or one DM, a page at a time.

export const SEARCH_PAGE_SIZE = 25;
// Discord's ceiling too: past a thousand results nobody pages, they narrow the search
const MAX_PAGE = 40;
// a filter naming more than this many people or channels is not a person typing
const MAX_LIST = 25;

export interface SearchRequest {
  requestId?: unknown;
  scope?: { serverId?: unknown; conversationId?: unknown };
  content?: unknown;
  authorIds?: unknown;
  channelIds?: unknown;
  mentionIds?: unknown;
  has?: unknown;
  before?: unknown;
  after?: unknown;
  authorType?: unknown;
  pinned?: unknown;
  sort?: unknown;
  page?: unknown;
}

const ids = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.length > 0 && v.length <= 64).slice(0, MAX_LIST) : []);
const time = (value: unknown): Date | null => (typeof value === 'number' && Number.isFinite(value) ? new Date(value) : null);
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');

/** The conversations a search may read: the server's visible channels
 * (narrowed to `channelIds` when given) or the one DM. Empty means nothing. */
async function searchableConversations(userId: string, request: SearchRequest): Promise<string[]> {
  const scope = request.scope ?? {};
  if (typeof scope.serverId === 'string') {
    const visible = await visibleChannelIdsInServer(scope.serverId, userId);
    const wanted = ids(request.channelIds);
    return wanted.length ? visible.filter((id) => wanted.includes(id)) : visible;
  }
  if (typeof scope.conversationId === 'string' && await conversationExistsForUser(scope.conversationId, userId)) return [scope.conversationId];
  return [];
}

/** "Mentions X": the @username in the text, matched as the composer writes it
 * (not inside another word or address). Read with each user's username of today. */
async function mentionCondition(userIds: string[]): Promise<SQL | null> {
  if (!userIds.length) return null;
  const named = await db.select({ username: users.username }).from(users).where(inArray(users.id, userIds));
  if (!named.length) return sql`false`;
  return or(...named.map(({ username }) => sql`${messages.text} ~* ${`(^|[^[:alnum:]_@.])@${escapeRegex(username)}($|[^[:alnum:]_.-])`}`))!;
}

async function handleSearchMessages(socket: AppSocket, request: SearchRequest): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  const requestId = typeof request.requestId === 'string' ? request.requestId.slice(0, 64) : '';
  const page = Math.min(MAX_PAGE, Math.max(1, Math.trunc(Number(request.page) || 1)));
  const reply = (total: number, messages: unknown[]) => send(socket, { t: 'search-messages-result', requestId, total, page, messages });

  const searchable = await searchableConversations(p.userId, request);
  if (!searchable.length) return reply(0, []);

  const content = typeof request.content === 'string' ? request.content.trim().slice(0, config.MAX_SEARCH_QUERY_LEN) : '';
  const has = Array.isArray(request.has) ? request.has.filter((k): k is ContentKind => (CONTENT_KINDS as readonly unknown[]).includes(k)) : [];
  const authorTypes = Array.isArray(request.authorType) ? request.authorType.filter((t) => t === 'user' || t === 'bot') : [];
  const authorIds = ids(request.authorIds);
  const before = time(request.before);
  const after = time(request.after);
  const text = content ? messageSearchQueries(content).tsQuery : null;

  const conditions: (SQL | undefined)[] = [
    inArray(messages.conversationId, searchable),
    // the lines a pin or a call leaves are not something anyone said
    notInArray(messages.kind, ['pin_notice', 'dm_call']),
    text ? sql`${messages.searchVector} @@ ${text}` : undefined,
    authorIds.length ? inArray(messages.authorId, authorIds) : undefined,
    // one of the two is no filter at all
    authorTypes.length === 1 ? (authorTypes[0] === 'bot' ? isNotNull(messages.webhookId) : isNull(messages.webhookId)) : undefined,
    request.pinned === true ? isNotNull(messages.pinnedAt) : undefined,
    before ? lt(messages.createdAt, before) : undefined,
    after ? gte(messages.createdAt, after) : undefined,
    // several kinds is any of them, as in Discord
    has.length ? or(...has.map(contentCondition)) : undefined,
    (await mentionCondition(ids(request.mentionIds))) ?? undefined,
  ];

  const sort = request.sort === 'oldest' || request.sort === 'relevant' ? request.sort : 'newest';
  const order = sort === 'oldest' ? [asc(messages.id)]
    : sort === 'relevant' && text ? [desc(sql`ts_rank(${messages.searchVector}, ${text})`), desc(messages.id)]
      : [desc(messages.id)];

  const rows = await db
    .select({ ...messageWithAuthorSelect, total: sql<number>`count(*) over()`.mapWith(Number) })
    .from(messages)
    .leftJoin(users, eq(users.id, messages.authorId))
    .where(and(...conditions))
    .orderBy(...order)
    .limit(SEARCH_PAGE_SIZE)
    .offset((page - 1) * SEARCH_PAGE_SIZE);
  reply(rows[0]?.total ?? 0, await serializeRows(rows));
}

export const handlers: HandlerTable = {
  'search-messages': handleSearchMessages,
};
