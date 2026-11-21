import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage, ClientMessage, SavedItem, ServerMessage } from '@/shared/types/protocol';

export interface SavedList {
  items: SavedItem[];
  hasMore: boolean;
  loading: boolean;
  loaded: boolean;
}

export const EMPTY_SAVED: SavedList = { items: [], hasMore: false, loading: false, loaded: false };

/** The account's saved messages: which ones (from the welcome, so every
 * message knows its menu entry at once) and the list, read when the inbox's
 * tab opens. Only this account's tabs ever hear about them. */
export function useSavedMessages(sendWs: (msg: ClientMessage) => boolean) {
  const [savedMessageIds, setSavedMessageIds] = useState<Set<number>>(() => new Set());
  const [savedList, setSavedList] = useState<SavedList>(EMPTY_SAVED);
  const listRef = useRef(savedList);
  useEffect(() => { listRef.current = savedList; }, [savedList]);

  const loadSaved = useCallback((more = false) => {
    const current = listRef.current;
    if (current.loading || (more && !current.hasMore)) return;
    const before = more ? current.items[current.items.length - 1]?.savedAt : undefined;
    if (!sendWs({ t: 'saved-list', ...(before !== undefined ? { before } : {}) })) return;
    setSavedList((list) => ({ ...list, loading: true }));
  }, [sendWs]);

  const onWelcome = useCallback((ids: number[] | undefined) => {
    setSavedMessageIds(new Set(ids ?? []));
    setSavedList(EMPTY_SAVED);
  }, []);

  const onSavedUpdated = useCallback((m: Extract<ServerMessage, { t: 'saved-updated' }>) => {
    setSavedMessageIds((prev) => {
      if (prev.has(m.msgId) === m.saved) return prev;
      const next = new Set(prev);
      if (m.saved) next.add(m.msgId); else next.delete(m.msgId);
      return next;
    });
    // a new save belongs at the top, with content only the server can send: read the list again
    setSavedList((list) => (m.saved ? (list.loaded ? { ...EMPTY_SAVED } : list) : { ...list, items: list.items.filter((item) => item.msgId !== m.msgId) }));
  }, []);

  const onSavedListResult = useCallback((m: Extract<ServerMessage, { t: 'saved-list-result' }>) => {
    setSavedList((list) => ({
      items: m.before === null ? m.items : [...list.items, ...m.items.filter((item) => !list.items.some((had) => had.msgId === item.msgId))],
      hasMore: m.hasMore,
      loading: false,
      loaded: true,
    }));
  }, []);

  /** Shown before the server confirms; `restore` puts it back if it refuses. */
  const hideSaved = useCallback((msgId: number) => {
    const before = listRef.current;
    setSavedList((list) => ({ ...list, items: list.items.filter((item) => item.msgId !== msgId) }));
    setSavedMessageIds((prev) => {
      if (!prev.has(msgId)) return prev;
      const next = new Set(prev);
      next.delete(msgId);
      return next;
    });
    return () => {
      setSavedList(before);
      setSavedMessageIds((prev) => new Set(prev).add(msgId));
    };
  }, []);

  const onMessageChanged = useCallback((message: ChatMessage) => {
    setSavedList((list) => {
      if (!list.items.some((item) => item.msgId === message.msgId && item.status === 'available')) return list;
      return { ...list, items: list.items.map((item) => (item.msgId === message.msgId && item.status === 'available' ? { ...item, message } : item)) };
    });
  }, []);

  /** The foreign key already took it off the server's list. */
  const onMessageDeleted = useCallback((msgId: number) => {
    setSavedMessageIds((prev) => {
      if (!prev.has(msgId)) return prev;
      const next = new Set(prev);
      next.delete(msgId);
      return next;
    });
    setSavedList((list) => (list.items.some((item) => item.msgId === msgId) ? { ...list, items: list.items.filter((item) => item.msgId !== msgId) } : list));
  }, []);

  return { savedMessageIds, savedList, loadSaved, hideSaved, onWelcome, onSavedUpdated, onSavedListResult, onMessageChanged, onMessageDeleted };
}
