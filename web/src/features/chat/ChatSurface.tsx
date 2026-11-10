import { hasPermission, PERMISSIONS } from '@/features/servers/permissionBits';
import { directUser } from '@/features/conversations/conversationUtils';
import { useEffect, useRef, useState } from 'react';
import type { DragEvent } from 'react';

import { ChatSurfaceWidthProvider, useMeasuredWidth } from '@/shared/lib/chatSurfaceWidth';
import { useRoom } from '@/state/RoomContext';
import { DirectComposerGate } from '@/features/friends/DirectComposerGate';
import { MessageComposer, type MessageComposerHandle } from './MessageComposer';
import { MessageTimeline } from './MessageTimeline';
import { TypingIndicator } from './TypingIndicator';
import { MediaViewerProvider } from './MediaViewerProvider';
import { DropOverlay, type DropTarget } from './DropOverlay';
import { carriesFiles, summarizeDrag, type DragSummary } from './dragSummary';

// Typing lives in a fixed-height rail above the composer, outside the box
// the ResizeObserver measures: someone starting or stopping typing must not
// change the list's bottom padding, or a list pinned to the bottom jumps.
const STATUS_RAIL_HEIGHT = 20;
// the gap between the newest message and the typing rail — and, while someone
// types, how far above the rail the messages fade out: the same 4px, so that
// fade ends exactly where the newest message does and never covers it
const RAIL_GAP = 4;

export function ChatSurface({ conversationId, onOpenProfile }: { conversationId: string; onOpenProfile: (userId: string) => void }) {
  const {
    state, setReplyingTo, windowGenerationByConversation, conversations, typingByConversation, allUsers,
    activeConversationId, unreadByConversation, unreadStartByConversation, markConversationRead,
  } = useRoom();
  // the same people TypingIndicator names: someone it can't show raises no background
  const someoneTyping = [...(typingByConversation.get(conversationId) ?? [])].some((id) => allUsers.has(id));
  // a channel the viewer can't write in (a webhook's announcements, say):
  // no composer, no typing, nothing to drop files into
  const shown = conversations.find((c) => c.id === conversationId);
  const readOnly = shown?.permissions !== undefined && !hasPermission(shown.permissions, PERMISSIONS.SEND_MESSAGES);
  // the server already drops ATTACH_FILES with SEND_MESSAGES, so this covers both
  const noFiles = shown?.permissions !== undefined && !hasPermission(shown.permissions, PERMISSIONS.ATTACH_FILES);
  const composerRef = useRef<MessageComposerHandle>(null);
  const composerWrapRef = useRef<HTMLDivElement | null>(null);
  const [composerHeight, setComposerHeight] = useState(0);
  const [drag, setDrag] = useState<DragSummary | null>(null);
  // whether the drop will land, decided as the drag comes in: besides the
  // permission, a DM gate (not friends, blocked) leaves no composer to take it
  const [dropAllowed, setDropAllowed] = useState(true);
  // dragenter/dragleave fire for every child crossed, so only the outermost
  // pair (depth back to 0) means the drag really left
  const dragDepthRef = useRef(0);
  // measured rather than assumed: the same surface renders in the main panel
  // and in the call's side panel, whose width isn't a fixed constant either
  const rootRef = useRef<HTMLDivElement | null>(null);
  const surfaceWidth = useMeasuredWidth(rootRef);

  useEffect(() => {
    const el = composerWrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.height;
      if (next != null) setComposerHeight(next);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Esc reads the conversation, as in Discord: from anywhere inside this
  // surface, or with nothing focused while it is the open conversation.
  // Whatever handled Esc first (an autocomplete, an edit, a voice take, a
  // popup with focus inside it) keeps it.
  const hasUnread = (unreadByConversation.get(conversationId) ?? 0) > 0 || unreadStartByConversation.has(conversationId);
  const isActive = activeConversationId === conversationId;
  useEffect(() => {
    if (!hasUnread) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.target instanceof Node ? event.target : null;
      const inside = !!target && !!rootRef.current?.contains(target);
      const unfocused = target === document.body || target === document.documentElement;
      if (inside || (unfocused && isActive)) markConversationRead(conversationId);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [hasUnread, isActive, conversationId, markConversationRead]);

  const peer = directUser(shown, state.me.userId, allUsers);
  const dropTarget: DropTarget = shown?.serverId ? { channel: shown.title } : peer ? { peer: peer.displayName } : {};

  function endDrag() {
    dragDepthRef.current = 0;
    setDrag(null);
  }
  // Only drags of files from outside the page: text, links and in-page drags
  // (dnd-kit uses pointer events, the voice list drags text) are left alone.
  function handleDragEnter(e: DragEvent<HTMLDivElement>) {
    if (!state.joined || !carriesFiles(e.dataTransfer)) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    if (dragDepthRef.current > 1) return;
    setDropAllowed(!noFiles && composerRef.current !== null);
    setDrag(summarizeDrag(e.dataTransfer));
  }
  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    if (!state.joined || !carriesFiles(e.dataTransfer)) return;
    // cancelled even when refused, or the browser would open the file in the tab on drop
    e.preventDefault();
    e.dataTransfer.dropEffect = dropAllowed ? 'copy' : 'none';
  }
  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    if (!state.joined || !carriesFiles(e.dataTransfer)) return;
    e.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDrag(null);
  }
  function handleDrop(e: DragEvent<HTMLDivElement>) {
    if (!state.joined || !carriesFiles(e.dataTransfer)) return;
    e.preventDefault();
    endDrag();
    if (!dropAllowed) return;
    const files = Array.from(e.dataTransfer.files);
    if (files.length) composerRef.current?.addFiles(files);
  }

  return (
    <div
      ref={rootRef}
      className="@container/chat relative flex min-h-0 flex-1 flex-col"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <ChatSurfaceWidthProvider width={surfaceWidth}>
        <MediaViewerProvider>
          <MessageTimeline key={`${conversationId}:${windowGenerationByConversation.get(conversationId) ?? 0}`} conversationId={conversationId} onReply={setReplyingTo} onOpenProfile={onOpenProfile} bottomPadding={composerHeight + STATUS_RAIL_HEIGHT + RAIL_GAP} />
        </MediaViewerProvider>
      </ChatSurfaceWidthProvider>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 transition-[height] duration-150 ease-out motion-reduce:transition-none"
        // Keep the typing indicator above the message list so it does not overlap the rail.
        style={{
          height: composerHeight + (someoneTyping ? STATUS_RAIL_HEIGHT + RAIL_GAP : 0),
          backgroundImage: someoneTyping
            ? `linear-gradient(to top, var(--surface-base) calc(100% - ${RAIL_GAP}px), transparent)`
            : 'linear-gradient(var(--surface-base), var(--surface-base))',
        }}
      />
      <div className="pointer-events-none absolute inset-x-0" style={{ bottom: composerHeight, height: STATUS_RAIL_HEIGHT }}>
        <TypingIndicator conversationId={conversationId} />
      </div>
      <div ref={composerWrapRef} className="absolute inset-x-0 bottom-0">
        {!readOnly && (
          <DirectComposerGate conversationId={conversationId}>
            <MessageComposer ref={composerRef} conversationId={conversationId} />
          </DirectComposerGate>
        )}
      </div>
      <DropOverlay drag={drag} target={dropTarget} allowed={dropAllowed} />
    </div>
  );
}
