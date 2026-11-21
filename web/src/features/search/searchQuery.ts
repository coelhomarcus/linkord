import { addDays, parseDayKey, type DayKey } from '@/shared/lib/calendarDay';
import type { ClientMessage } from '@/shared/types/protocol';

/** What a message can carry, for `tem:`. Mirrors server/src/modules/messages/messageContent.ts. */
export const CONTENT_KINDS = ['image', 'video', 'link', 'file', 'audio', 'gif', 'sticker', 'embed'] as const;
export type ContentKind = (typeof CONTENT_KINDS)[number];

/** The filters written as chips in the field: `de:`, `em:`, `tem:` and `menciona:`. */
export type TokenKey = 'from' | 'in' | 'has' | 'mentions';
export const TOKEN_KEYS: TokenKey[] = ['from', 'in', 'has', 'mentions'];

export interface SearchToken {
  key: TokenKey;
  /** a user id, a channel id, or a ContentKind */
  value: string;
  /** what the chip shows: a username, a channel's name; a kind is translated where it is drawn */
  label: string;
}

export type AuthorType = 'user' | 'bot';
export type SearchSort = 'newest' | 'oldest' | 'relevant';
export type SearchScope = { serverId: string } | { conversationId: string };

export interface SearchQuery {
  text: string;
  tokens: SearchToken[];
  /** both ends of the day range are included; '' is an open end */
  dateFrom: DayKey;
  dateTo: DayKey;
  authorTypes: AuthorType[];
  pinned: boolean;
}

export const EMPTY_QUERY: SearchQuery = { text: '', tokens: [], dateFrom: '', dateTo: '', authorTypes: [], pinned: false };

export const SEARCH_PAGE_SIZE = 25;

/** A query with nothing in it searches nothing: the field just closes. */
export function isEmptyQuery(query: SearchQuery): boolean {
  return !query.text.trim() && activeFilterCount(query) === 0;
}

/** What "Filtros (n)" counts: each chip, the date, the author type and pinned. */
export function activeFilterCount(query: SearchQuery): number {
  return query.tokens.length + (query.dateFrom || query.dateTo ? 1 : 0) + (query.authorTypes.length ? 1 : 0) + (query.pinned ? 1 : 0);
}

export function addToken(query: SearchQuery, token: SearchToken): SearchQuery {
  if (query.tokens.some((t) => t.key === token.key && t.value === token.value)) return query;
  return { ...query, tokens: [...query.tokens, token] };
}

export function removeToken(query: SearchQuery, token: Pick<SearchToken, 'key' | 'value'>): SearchQuery {
  return { ...query, tokens: query.tokens.filter((t) => !(t.key === token.key && t.value === token.value)) };
}

export const tokensOf = (query: SearchQuery, key: TokenKey): SearchToken[] => query.tokens.filter((t) => t.key === key);

/** Replaces every chip of one key, keeping the others in place. */
export function setTokens(query: SearchQuery, key: TokenKey, tokens: SearchToken[]): SearchQuery {
  return { ...query, tokens: [...query.tokens.filter((t) => t.key !== key), ...tokens] };
}

/** The same search, whatever order its chips were added in: what history dedupes on. */
export function queryKey(query: SearchQuery): string {
  const tokens = [...query.tokens].sort((a, b) => (a.key + a.value).localeCompare(b.key + b.value)).map((t) => `${t.key}:${t.value}`);
  return JSON.stringify([query.text.trim().toLowerCase(), tokens, query.dateFrom, query.dateTo, [...query.authorTypes].sort(), query.pinned]);
}

const dayStart = (key: DayKey): number | undefined => parseDayKey(key)?.getTime();

/** The socket request for one page. Days become the viewer's own midnight bounds. */
export function toSearchRequest(query: SearchQuery, scope: SearchScope, sort: SearchSort, page: number, requestId: string): Extract<ClientMessage, { t: 'search-messages' }> {
  const values = (key: TokenKey) => tokensOf(query, key).map((t) => t.value);
  const has = values('has').filter((v): v is ContentKind => (CONTENT_KINDS as readonly string[]).includes(v));
  const after = query.dateFrom ? dayStart(query.dateFrom) : undefined;
  const before = query.dateTo ? dayStart(addDays(query.dateTo, 1)) : undefined;
  return {
    t: 'search-messages',
    requestId,
    scope,
    sort,
    page,
    ...(query.text.trim() ? { content: query.text.trim() } : {}),
    ...(values('from').length ? { authorIds: values('from') } : {}),
    ...('serverId' in scope && values('in').length ? { channelIds: values('in') } : {}),
    ...(values('mentions').length ? { mentionIds: values('mentions') } : {}),
    ...(has.length ? { has } : {}),
    ...(after !== undefined ? { after } : {}),
    ...(before !== undefined ? { before } : {}),
    ...(query.authorTypes.length ? { authorType: query.authorTypes } : {}),
    ...(query.pinned ? { pinned: true } : {}),
  };
}

/** Reads back a stored query, dropping whatever does not fit (an older or edited entry). */
export function parseStoredQuery(raw: unknown): SearchQuery | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Partial<Record<keyof SearchQuery, unknown>>;
  const tokens = Array.isArray(value.tokens) ? value.tokens.filter((t): t is SearchToken => (
    !!t && typeof t === 'object' && TOKEN_KEYS.includes((t as SearchToken).key)
    && typeof (t as SearchToken).value === 'string' && typeof (t as SearchToken).label === 'string'
  )) : [];
  const query: SearchQuery = {
    text: typeof value.text === 'string' ? value.text : '',
    tokens,
    dateFrom: typeof value.dateFrom === 'string' ? value.dateFrom : '',
    dateTo: typeof value.dateTo === 'string' ? value.dateTo : '',
    authorTypes: Array.isArray(value.authorTypes) ? value.authorTypes.filter((t): t is AuthorType => t === 'user' || t === 'bot') : [],
    pinned: value.pinned === true,
  };
  return isEmptyQuery(query) ? null : query;
}
