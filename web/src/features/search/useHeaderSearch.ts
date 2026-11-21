import { useCallback, useRef, useState } from 'react';
import type { ChatMessage, ClientMessage, ServerMessage } from '@/shared/types/protocol';
import { i18n } from '@/shared/i18n/init';
import { toSearchRequest, type SearchQuery, type SearchScope, type SearchSort } from './searchQuery';

export interface MessageSearchState {
  scope: SearchScope;
  query: SearchQuery;
  sort: SearchSort;
  page: number;
  /** null until the first answer of this search */
  total: number | null;
  messages: ChatMessage[];
  loading: boolean;
  error: string | null;
}

/** The header search: what was asked, where, and the page that came back. One
 * search at a time; an answer to a search since replaced is dropped by its
 * requestId. Null while the results panel is closed. */
export function useHeaderSearch(sendWs: (msg: ClientMessage) => boolean) {
  const [search, setSearchState] = useState<MessageSearchState | null>(null);
  // the latest state, for the callbacks that start a request from it
  const searchRef = useRef<MessageSearchState | null>(null);
  const requestIdRef = useRef<string | null>(null);

  const commit = useCallback((change: (current: MessageSearchState | null) => MessageSearchState | null) => {
    const next = change(searchRef.current);
    if (next === searchRef.current) return;
    searchRef.current = next;
    setSearchState(next);
  }, []);

  const request = useCallback((next: Pick<MessageSearchState, 'scope' | 'query' | 'sort' | 'page'>) => {
    const requestId = crypto.randomUUID();
    requestIdRef.current = requestId;
    const sent = sendWs(toSearchRequest(next.query, next.scope, next.sort, next.page, requestId));
    // a new order or page keeps what is shown until the answer replaces it
    commit((current) => ({
      messages: current?.messages ?? [], total: current?.total ?? null, ...next,
      loading: sent,
      error: sent ? null : i18n.t('search:errors.offline'),
    }));
  }, [sendWs, commit]);

  const runSearch = useCallback((scope: SearchScope, query: SearchQuery) => {
    commit(() => null);
    request({ scope, query, sort: 'newest', page: 1 });
  }, [request, commit]);

  const setSearchSort = useCallback((sort: SearchSort) => {
    const current = searchRef.current;
    if (current) request({ ...current, sort, page: 1 });
  }, [request]);

  const setSearchPage = useCallback((page: number) => {
    const current = searchRef.current;
    if (current) request({ ...current, page });
  }, [request]);

  const closeSearch = useCallback(() => {
    requestIdRef.current = null;
    commit(() => null);
  }, [commit]);

  const onSearchResult = useCallback((m: Extract<ServerMessage, { t: 'search-messages-result' }>) => {
    if (m.requestId !== requestIdRef.current) return;
    commit((current) => (current ? { ...current, messages: m.messages, total: m.total, page: m.page, loading: false, error: null } : current));
  }, [commit]);

  /** A result that pointed at a message deleted since: said in the panel the click came from. */
  const setSearchError = useCallback((message: string) => {
    commit((current) => (current ? { ...current, error: message } : current));
  }, [commit]);

  /** Drops a result deleted while it is shown. */
  const onMessageDeleted = useCallback((msgId: number) => {
    commit((current) => (current?.messages.some((m) => m.msgId === msgId)
      ? { ...current, messages: current.messages.filter((m) => m.msgId !== msgId), total: current.total !== null ? current.total - 1 : null }
      : current));
  }, [commit]);

  const onMessageChanged = useCallback((message: ChatMessage) => {
    commit((current) => (current?.messages.some((m) => m.msgId === message.msgId)
      ? { ...current, messages: current.messages.map((m) => (m.msgId === message.msgId ? message : m)) }
      : current));
  }, [commit]);

  return { search, runSearch, setSearchSort, setSearchPage, closeSearch, onSearchResult, setSearchError, onMessageDeleted, onMessageChanged };
}
