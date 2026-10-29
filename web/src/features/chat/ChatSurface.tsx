import { UploadSimpleIcon } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import type { DragEvent } from 'react';

import { ChatSurfaceWidthProvider, useMeasuredWidth } from '@/shared/lib/chatSurfaceWidth';
import { useRoom } from '@/state/RoomContext';
import { DirectComposerGate } from '@/features/friends/DirectComposerGate';
import { MessageComposer, type MessageComposerHandle } from './MessageComposer';
import { MessageTimeline } from './MessageTimeline';
import { TypingIndicator } from './TypingIndicator';
import { MediaViewerProvider } from './MediaViewerProvider';

// Typing lives in a fixed-height rail above the composer, outside the box
// the ResizeObserver measures: someone starting or stopping typing must not
// change the list's bottom padding, or a list pinned to the bottom jumps.
const STATUS_RAIL_HEIGHT = 24;
// how far above the composer (or the typing rail, while it shows) the messages
// fade out; the list's bottom padding clears it, so the newest message never
// sits under it
const FADE_HEIGHT = 12;

function hasFiles(e: DragEvent<HTMLDivElement>): boolean {
  return Array.from(e.dataTransfer.types).includes('Files');
}

export function ChatSurface({ conversationId, onOpenProfile, surfaceId = 'main' }: { conversationId: string; onOpenProfile: (userId: string) => void; surfaceId?: 'main' | 'call' }) {
  const { state, setReplyingTo, windowGenerationByConversation, conversations, typingByConversation, allUsers } = useRoom();
  // the same people TypingIndicator names: someone it can't show raises no background
  const someoneTyping = [...(typingByConversation.get(conversationId) ?? [])].some((id) => allUsers.has(id));
  // only its webhook posts in a bot: no composer, no typing, nothing to drop files into
  const readOnly = conversations.find((c) => c.id === conversationId)?.type === 'bot';
  const composerRef = useRef<MessageComposerHandle>(null);
  const composerWrapRef = useRef<HTMLDivElement | null>(null);
  const [composerHeight, setComposerHeight] = useState(0);
  const [dragActive, setDragActive] = useState(false);
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

  function handleDragEnter(e: DragEvent<HTMLDivElement>) {
    if (readOnly || !state.joined || !hasFiles(e)) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    setDragActive(true);
  }
  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    if (readOnly || !state.joined || !hasFiles(e)) return;
    e.preventDefault();
  }
  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    if (!state.joined || !hasFiles(e)) return;
    e.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragActive(false);
  }
  function handleDrop(e: DragEvent<HTMLDivElement>) {
    if (!state.joined || !hasFiles(e)) return;
    e.preventDefault();
    dragDepthRef.current = 0;
    setDragActive(false);
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
          <MessageTimeline key={`${conversationId}:${windowGenerationByConversation.get(conversationId) ?? 0}`} surfaceId={surfaceId} conversationId={conversationId} onReply={setReplyingTo} onOpenProfile={onOpenProfile} bottomPadding={composerHeight + STATUS_RAIL_HEIGHT + FADE_HEIGHT} />
        </MediaViewerProvider>
      </ChatSurfaceWidthProvider>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 transition-[height] duration-150 ease-out motion-reduce:transition-none"
        // solid behind the composer, and behind the typing rail only while
        // someone types — so "fulano está digitando" never reads over the
        // messages under it — with a short fade above; the rail's room stays
        // reserved either way, so nothing in the list moves when it shows
        style={{
          height: composerHeight + (someoneTyping ? STATUS_RAIL_HEIGHT : 0) + FADE_HEIGHT,
          backgroundImage: `linear-gradient(to top, var(--surface-base) calc(100% - ${FADE_HEIGHT}px), transparent)`,
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
      {dragActive && (
        <div className="pointer-events-none absolute inset-0 z-10 m-2 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary bg-(--surface-base)/90 text-text-primary">
          <UploadSimpleIcon size={28} className="text-primary" />
          <p className="text-body font-medium">Solte para anexar</p>
        </div>
      )}
    </div>
  );
}
