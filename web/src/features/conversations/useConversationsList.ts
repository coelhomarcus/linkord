import { useCallback, useRef, useState } from 'react';
import type { ClientMessage, Conversation, DirectSummary, ServerMessage } from '@/shared/types/protocol';

/** The server sends a DM without a title or server: fill them in, so a DM
 * and a channel read the same everywhere. */
function toDirectConversation(summary: DirectSummary): Conversation {
  return { ...summary, title: '', serverId: null };
}

/** Mirrors listForUser's own ORDER BY (server/src/modules/conversations.ts)
 * — pinned first (most recently pinned first among those), then everyone
 * else by recency. Used both for the optimistic pin re-sort and for
 * re-sorting after any incremental update that could change ordering.
 * Deliberately `lastMessageAt ?? createdAt`, not `updatedAt` — a rename or
 * a message edit/delete must not resort the sidebar, only a genuinely NEW
 * message does (server-side: schema.ts#conversations, touchConversation). */
function sortConversations(list: Conversation[]): Conversation[] {
  return [...list].sort((a, b) => (
    Number(!!b.pinnedAt) - Number(!!a.pinnedAt)
    || (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0)
    || (b.lastMessageAt ?? b.createdAt) - (a.lastMessageAt ?? a.createdAt)
  ));
}

/** The DM list + which conversation (DM or channel) is currently open. Message
 * content itself (messagesByConversation, unread counts, reply/edit draft
 * state) lives in useChatMessages — this hook only owns the list of
 * conversations and the "which one is active" cursor.
 *
 * `setActiveConversation` is intentionally BARE (just moves the cursor) —
 * the original single-component version also cleared unread/reply/editing
 * state on every switch, but that state now lives in useChatMessages, so
 * RoomProvider composes the full "open/close a conversation" behavior from
 * both hooks' primitives instead of either hook reaching into the other's
 * state. */
export function useConversationsList(sendWs: (msg: ClientMessage) => void) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const conversationsRef = useRef<Conversation[]>([]);
  const [activeConversationId, setActiveConversationIdState] = useState<string | null>(null);
  const activeConversationIdRef = useRef<string | null>(null);

  const setInitial = useCallback((initial: DirectSummary[]) => {
    const list = initial.map(toDirectConversation);
    setConversations(list);
    conversationsRef.current = list;
  }, []);

  const setActiveConversation = useCallback((conversationId: string) => {
    activeConversationIdRef.current = conversationId;
    setActiveConversationIdState(conversationId);
  }, []);

  const clearActiveConversation = useCallback(() => {
    activeConversationIdRef.current = null;
    setActiveConversationIdState(null);
  }, []);

  const openDirect = useCallback((userId: string) => sendWs({ t: 'direct-open', userId }), [sendWs]);

  /** List-membership + cursor half of "close a conversation" — optimistic,
   * same shape as 'conversation-deleted' minus the parts that only make
   * sense for an actual delete. The caller also clears unread (owned by
   * useChatMessages) and sends the close itself. */
  const removeConversation = useCallback((conversationId: string) => {
    setConversations((prev) => prev.filter((c) => c.id !== conversationId));
    conversationsRef.current = conversationsRef.current.filter((c) => c.id !== conversationId);
    if (conversationId === activeConversationIdRef.current) clearActiveConversation();
  }, [clearActiveConversation]);

  const pinConversation = useCallback((conversationId: string, pinned: boolean) => {
    // Optimistic re-sort so the row jumps immediately instead of waiting on
    // the round-trip; the real 'conversation-pinned' broadcast (below)
    // settles it — including for this same tab, since it's a no-op once
    // the optimistic value already matches.
    const next = sortConversations(conversationsRef.current.map((c) => (c.id === conversationId ? { ...c, pinnedAt: pinned ? Date.now() : null } : c)));
    conversationsRef.current = next;
    setConversations(next);
    sendWs({ t: 'conversation-pin', conversationId, pinned });
  }, [sendWs]);

  /** A DM now belongs on this client's list for the first time — upsert by
   * id (same merge onConversationOpened does), but never switches the active
   * conversation; that's what 'conversation-opened' is for. */
  const onConversationCreated = useCallback((m: Extract<ServerMessage, { t: 'conversation-created' }>) => {
    const conversation = toDirectConversation(m.conversation);
    const idx = conversationsRef.current.findIndex((c) => c.id === conversation.id);
    const base = idx === -1 ? [conversation, ...conversationsRef.current] : conversationsRef.current.map((c) => (c.id === conversation.id ? conversation : c));
    const next = sortConversations(base);
    conversationsRef.current = next;
    setConversations(next);
  }, []);

  /** A conversation changed (rename, avatar, or message activity bumping
   * lastMessageAt/updatedAt) — replace by id and re-sort, since activity/pin
   * ordering could have changed. An update for one this client does NOT have
   * yet is an insert: it is exactly how the other person learns a DM exists.
   * An empty DM is never listed; the first message or the start of a call
   * is what surfaces it (see touchConversation), and a DM the user closed
   * comes back the same way. */
  const onConversationUpdated = useCallback((m: Extract<ServerMessage, { t: 'conversation-updated' }>) => {
    const conversation = toDirectConversation(m.conversation);
    const known = conversationsRef.current.some((c) => c.id === conversation.id);
    const base = known
      ? conversationsRef.current.map((c) => (c.id === conversation.id ? conversation : c))
      : [conversation, ...conversationsRef.current];
    const next = sortConversations(base);
    conversationsRef.current = next;
    setConversations(next);
  }, []);

  /** Syncs pin state pushed from ANOTHER of this user's own sessions/tabs —
   * this tab's own pinConversation() already applied it optimistically, so
   * this is a no-op for the tab that acted and a sync for the others. */
  const onConversationPinned = useCallback((m: Extract<ServerMessage, { t: 'conversation-pinned' }>) => {
    if (!conversationsRef.current.some((c) => c.id === m.conversationId)) return;
    const next = sortConversations(conversationsRef.current.map((c) => (c.id === m.conversationId ? { ...c, pinnedAt: m.pinnedAt } : c)));
    conversationsRef.current = next;
    setConversations(next);
  }, []);

  /** `openConversationFull` is RoomProvider's composed openConversation
   * (cursor + unread/reply/editing clear + sendWs) — passed in at call
   * time since this handler needs the FULL behavior, not just the cursor
   * move this hook owns on its own. */
  const onConversationOpened = useCallback((m: Extract<ServerMessage, { t: 'conversation-opened' }>, openConversationFull: (conversationId: string) => void) => {
    // An empty (or closed) direct conversation never shows up in
    // conversation-list — the server sends its summary straight to the
    // opener instead so it can still be rendered/typed into for this
    // session; it becomes "real" history for everyone once a message
    // is actually sent (touchConversation broadcasts the list then).
    // Re-sorted like every other list-changing handler here — this is also
    // what fires for a brand-new DM, so skipping the sort used to let it
    // land above a pinned conversation instead of respecting pinnedAt.
    const conversation = toDirectConversation(m.conversation);
    const idx = conversationsRef.current.findIndex((c) => c.id === conversation.id);
    const base = idx === -1
      ? [conversation, ...conversationsRef.current]
      : conversationsRef.current.map((c) => (c.id === conversation.id ? conversation : c));
    const nextConversations = sortConversations(base);
    conversationsRef.current = nextConversations;
    setConversations(nextConversations);
    openConversationFull(m.conversationId);
  }, []);

  /** Only the list-membership half of "a conversation got deleted" — the
   * caller (RoomProvider) also tells useChatMessages to drop its cached
   * messages/unread count, and useCallLifecycle to leave the call if it was
   * the active one, since none of that state lives here. */
  const onConversationDeleted = useCallback((m: Extract<ServerMessage, { t: 'conversation-deleted' }>) => {
    setConversations((prev) => prev.filter((c) => c.id !== m.conversationId));
    conversationsRef.current = conversationsRef.current.filter((c) => c.id !== m.conversationId);
    if (m.conversationId === activeConversationIdRef.current) clearActiveConversation();
  }, [clearActiveConversation]);

  return {
    conversations, conversationsRef, activeConversationId, activeConversationIdRef,
    setInitial, setActiveConversation, clearActiveConversation, removeConversation,
    openDirect, pinConversation,
    onConversationCreated, onConversationUpdated,
    onConversationPinned, onConversationOpened, onConversationDeleted,
  };
}
