import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage, ClientMessage, PinnedItem, ServerMessage } from '@/shared/types/protocol';

export interface PinsList {
  items: PinnedItem[];
  hasMore: boolean;
  /** a page was asked for and has not arrived */
  loading: boolean;
  /** the first page arrived at least once: an empty list is really empty */
  loaded: boolean;
}

export const EMPTY_PINS: PinsList = { items: [], hasMore: false, loading: false, loaded: false };

/** The pinned messages of each conversation, read on demand, and which
 * conversations got a pin since this account last looked (the header's dot).
 * A pin or unpin anywhere drops that conversation's list, so the next open
 * reads it again rather than guessing where a re-pinned message goes. */
export function usePins(sendWs: (msg: ClientMessage) => boolean, myUserIdRef: { current: string | null }) {
  const [unseenPins, setUnseenPins] = useState<Set<string>>(() => new Set());
  const [pinsByConversation, setPinsByConversation] = useState<Map<string, PinsList>>(() => new Map());
  const pinsRef = useRef(pinsByConversation);
  useEffect(() => { pinsRef.current = pinsByConversation; }, [pinsByConversation]);

  const patch = useCallback((conversationId: string, change: (list: PinsList) => PinsList) => {
    setPinsByConversation((prev) => new Map(prev).set(conversationId, change(prev.get(conversationId) ?? EMPTY_PINS)));
  }, []);

  const loadPins = useCallback((conversationId: string, more = false) => {
    const current = pinsRef.current.get(conversationId) ?? EMPTY_PINS;
    if (current.loading || (more && !current.hasMore)) return;
    const before = more ? current.items[current.items.length - 1]?.pinnedAt : undefined;
    if (!sendWs({ t: 'pins-list', conversationId, ...(before !== undefined ? { before } : {}) })) return;
    patch(conversationId, (list) => ({ ...list, loading: true }));
  }, [sendWs, patch]);

  const ackPins = useCallback((conversationId: string) => {
    setUnseenPins((prev) => {
      if (!prev.has(conversationId)) return prev;
      const next = new Set(prev);
      next.delete(conversationId);
      return next;
    });
    sendWs({ t: 'pins-ack', conversationId });
  }, [sendWs]);

  const onWelcome = useCallback((unseen: string[] | undefined) => {
    setUnseenPins(new Set(unseen ?? []));
    // a reconnect may have missed pins: every list is read again when next opened
    setPinsByConversation(new Map());
  }, []);

  const onPinsUpdated = useCallback((m: Extract<ServerMessage, { t: 'conversation-pins-updated' }>) => {
    setPinsByConversation((prev) => {
      if (!prev.has(m.conversationId)) return prev;
      const next = new Map(prev);
      next.delete(m.conversationId);
      return next;
    });
    // an unpin never lights the dot, and whoever pinned has seen it, in every one of their tabs
    if (!m.pinned || m.by === myUserIdRef.current) return;
    setUnseenPins((prev) => (prev.has(m.conversationId) ? prev : new Set(prev).add(m.conversationId)));
  }, [myUserIdRef]);

  const onPinsListResult = useCallback((m: Extract<ServerMessage, { t: 'pins-list-result' }>) => {
    patch(m.conversationId, (list) => ({
      items: m.before === null ? m.items : [...list.items, ...m.items.filter((item) => !list.items.some((had) => had.message.msgId === item.message.msgId))],
      hasMore: m.hasMore,
      loading: false,
      loaded: true,
    }));
  }, [patch]);

  const onPinsSeen = useCallback((m: Extract<ServerMessage, { t: 'pins-seen' }>) => {
    setUnseenPins((prev) => {
      if (!prev.has(m.conversationId)) return prev;
      const next = new Set(prev);
      next.delete(m.conversationId);
      return next;
    });
  }, []);

  /** Keeps a shown list current while it is open: an edit, a reaction, an unpin. */
  const onMessageChanged = useCallback((message: ChatMessage) => {
    setPinsByConversation((prev) => {
      const list = prev.get(message.conversationId);
      if (!list || !list.items.some((item) => item.message.msgId === message.msgId)) return prev;
      const items = message.pinned
        ? list.items.map((item) => (item.message.msgId === message.msgId ? { ...item, message } : item))
        : list.items.filter((item) => item.message.msgId !== message.msgId);
      return new Map(prev).set(message.conversationId, { ...list, items });
    });
  }, []);

  const onMessageDeleted = useCallback((conversationId: string, msgId: number) => {
    setPinsByConversation((prev) => {
      const list = prev.get(conversationId);
      if (!list || !list.items.some((item) => item.message.msgId === msgId)) return prev;
      return new Map(prev).set(conversationId, { ...list, items: list.items.filter((item) => item.message.msgId !== msgId) });
    });
  }, []);

  return { unseenPins, pinsByConversation, loadPins, ackPins, onWelcome, onPinsUpdated, onPinsListResult, onPinsSeen, onMessageChanged, onMessageDeleted };
}
