import { useTranslation } from 'react-i18next';
import { ArrowDownIcon, ArrowUpIcon } from '@phosphor-icons/react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { defaultRangeExtractor, measureElement as measureRowElement, useVirtualizer, type Range } from '@tanstack/react-virtual';

import { buildMentionLookup } from '@/shared/lib/mentions';
import { useRoom } from '@/state/RoomContext';
import { EmptyState } from '@/shared/ui/empty-state';
import { conversationTitle } from '@/features/conversations/conversationUtils';
import type { ChatMessage } from '@/shared/types/protocol';
import { MessageRow } from './MessageRow';
import { ArrivalMotion } from './ArrivalMotion';
import { buildTimelineItems } from './messageTimelineItems';
import type { OutboxEntry } from './useMessageOutbox';
import { readingPositionFor, saveReadingPosition } from './readingPositions';
import { estimateRowHeight, rememberedRowHeight, rememberRowHeight } from './rowHeights';
import { useChatSurfaceWidth } from '@/shared/lib/chatSurfaceWidth';

const EMPTY_MESSAGES: ChatMessage[] = [];
const EMPTY_PENDING: OutboxEntry[] = [];
// Within this distance of the bottom the list counts as "at the present"
// and follows new messages; farther up, the reader's place is kept.
const AT_END_THRESHOLD = 80;
// Only this close to the bottom does the list stay glued to it while rows
// grow (a video learning its shape, a card arriving). A reader who has just
// started scrolling up, still inside AT_END_THRESHOLD, keeps their place:
// pinning them too pulled the first scroll back down every time a row grew.
const PINNED_THRESHOLD = 8;
// Rows from an edge at which the next page is requested.
const PAGE_TRIGGER_ROWS = 3;
const HIGHLIGHT_MS = 1500;
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);
const PREPEND_SETTLE_FRAMES = 3;
// The initial placement is done once position and content height hold for
// this many frames in a row — and gives up waiting after the cap.
const PLACEMENT_STABLE_FRAMES = 2;
const PLACEMENT_MAX_FRAMES = 30;
// the surface's width before ChatSurface has measured it (and in tests)
const FALLBACK_SURFACE_WIDTH = 800;

export function MessageTimeline({ surfaceId = 'main', conversationId, onReply, onOpenProfile, bottomPadding }: {
  /** Scopes the remembered reading position: two panels showing the same
   * conversation each keep their own. */
  surfaceId?: string;
  conversationId: string;
  onReply: (message: ChatMessage) => void;
  onOpenProfile: (userId: string) => void;
  bottomPadding: number;
}) {
  const { t } = useTranslation('chat');
  const {
    messagesByConversation,
    allUsers,
    conversations,
    hasMoreByConversation,
    loadingOlderByConversation,
    loadOlderMessages,
    hasMoreAfterByConversation,
    loadingNewerByConversation,
    loadNewerMessages,
    newerCountByConversation,
    pendingJumpTarget,
    clearPendingJumpTarget,
    jumpToMessage,
    openConversation,
    pendingByConversation,
    unreadStartByConversation,
    editingMsgId,
    state,
  } = useRoom();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const surfaceWidth = useChatSurfaceWidth(FALLBACK_SURFACE_WIDTH);
  const [highlightedMsgId, setHighlightedMsgId] = useState<number | null>(null);
  const highlightTimeoutRef = useRef<number | null>(null);
  const mentionLookup = useMemo(() => buildMentionLookup(allUsers), [allUsers]);
  const messages = messagesByConversation.get(conversationId) ?? EMPTY_MESSAGES;
  // no entry yet = its history hasn't arrived (any message, even a live one,
  // creates the entry), so an empty list here is not yet "no messages"
  const historyArrived = messagesByConversation.has(conversationId);
  const hasMoreBefore = hasMoreByConversation.get(conversationId) !== false;
  const hasMoreAfter = hasMoreAfterByConversation.get(conversationId) === true;
  const isLoadingOlder = loadingOlderByConversation.has(conversationId);
  const isLoadingNewer = loadingNewerByConversation.has(conversationId);
  const pending = pendingByConversation.get(conversationId) ?? EMPTY_PENDING;
  const { userId: myUserId, displayName: myName, avatar: myAvatar } = state.me;
  const conversation = conversations.find((c) => c.id === conversationId);
  const firstUnreadId = unreadStartByConversation.get(conversationId);
  const items = useMemo(
    () => buildTimelineItems(messages, pending, { userId: myUserId, name: myName, avatar: myAvatar }, firstUnreadId, hasMoreBefore),
    [messages, pending, myUserId, myName, myAvatar, firstUnreadId, hasMoreBefore],
  );
  const unreadIndex = items.findIndex((item) => item.type === 'unread');
  // the first unread message is in an older page than the window holds:
  // its line is above the reader whatever the scroll position
  const unreadInOlderPage = firstUnreadId !== undefined && unreadIndex < 0 && hasMoreBefore
    && messages.length > 0 && messages[0]!.msgId > firstUnreadId;

  // Rows playing audio/video are tracked from the media events themselves
  // (they don't bubble, but they do pass the container in capture).
  const [playingMsgIds, setPlayingMsgIds] = useState<Set<number>>(new Set());
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = (event: Event, playing: boolean) => {
      const row = (event.target as Element | null)?.closest?.('[data-msg-id]');
      const msgId = Number(row?.getAttribute('data-msg-id'));
      if (!Number.isFinite(msgId)) return;
      setPlayingMsgIds((prev) => {
        if (prev.has(msgId) === playing) return prev;
        const next = new Set(prev);
        if (playing) next.add(msgId); else next.delete(msgId);
        return next;
      });
    };
    const onPlay = (event: Event) => update(event, true);
    const onStop = (event: Event) => update(event, false);
    el.addEventListener('play', onPlay, true);
    el.addEventListener('pause', onStop, true);
    el.addEventListener('ended', onStop, true);
    return () => {
      el.removeEventListener('play', onPlay, true);
      el.removeEventListener('pause', onStop, true);
      el.removeEventListener('ended', onStop, true);
    };
  }, []);

  // Rows that must survive scrolling away stay mounted outside the rendered
  // range: an open editor (its text), and media that's playing (unmounting
  // would silently stop it). A handful at most.
  const retainedIndexes = useMemo(() => {
    const out: number[] = [];
    items.forEach((item, index) => {
      if (item.type !== 'message') return;
      if (item.message.msgId === editingMsgId || playingMsgIds.has(item.message.msgId)) out.push(index);
    });
    return out;
  }, [items, editingMsgId, playingMsgIds]);
  const rangeExtractor = useCallback((range: Range) => {
    const indexes = defaultRangeExtractor(range);
    const extra = retainedIndexes.filter((index) => !indexes.includes(index));
    return extra.length ? [...indexes, ...extra].sort((a, b) => a - b) : indexes;
  }, [retainedIndexes]);

  const virtualizer = useVirtualizer({
    // rows are measured from ref callbacks, during React's commit, where a
    // flushSync re-render is not allowed (React 19 warns and defers it anyway)
    useFlushSync: false,
    count: items.length,
    getScrollElement: () => scrollRef.current,
    // a row seen before at this width starts at its measured height
    estimateSize: (index) => {
      const item = items[index];
      if (!item) return 40;
      return rememberedRowHeight(surfaceId, item, surfaceWidth) ?? estimateRowHeight(item, surfaceWidth);
    },
    measureElement: (element, entry, instance) => {
      const height = measureRowElement(element, entry, instance);
      const item = items[instance.indexFromElement(element)];
      if (item) rememberRowHeight(surfaceId, item, surfaceWidth, height);
      return height;
    },
    getItemKey: (index) => items[index]?.key ?? index,
    overscan: 8,
    // the library keeps the first visible row (and the offset inside it)
    // in place when rows are added above, and follows appends at the end
    anchorTo: 'end',
    // only at the real present: at the end of an older window a newer page
    // must keep the reader's place, or following it would request the next
    // page, and the next, all the way to the present on its own
    followOnAppend: !hasMoreAfter,
    // the library keeps the distance to the end, rather than the reader's
    // row, for any resize within this distance: only when really there
    scrollEndThreshold: PINNED_THRESHOLD,
    paddingStart: 12,
    paddingEnd: bottomPadding,
    rangeExtractor,
    // A row that changes size (a card filling in, a video learning its
    // shape) is measured in the ResizeObserver callback, after layout and
    // before paint, and the rows below it plus scrollTop are written to the
    // DOM right there. Going through a React render, or deferring the
    // measurement to the next frame, painted a frame or two with the grown
    // row over its neighbour before everything jumped into place.
    directDomUpdates: true,
  });
  const virtualItems = virtualizer.getVirtualItems();

  const jumpIndex = pendingJumpTarget && pendingJumpTarget.conversationId === conversationId
    ? items.findIndex((item) => item.type === 'message' && item.message.msgId === pendingJumpTarget.msgId)
    : -1;

  // Mounted per window (ChatSurface keys it), so this runs once: start on
  // the jump target when there is one, at the present otherwise. Paging
  // waits for it, or the first render — sitting at the top before this
  // scroll — would fetch history nobody asked for.
  //
  // Rows only get their real heights as they are measured, a frame or more
  // after the first scroll, so a single placement lands on estimates and the
  // list visibly jumped to the wrong place and back. The placement is applied
  // again every frame until the position and the content height have held
  // still, and the list stays invisible until then: nothing is painted
  // anywhere but where it ends up.
  const [ready, setReady] = useState(false);
  // the scroll listener must not record the jumps of the initial placement
  const readyRef = useRef(false);
  useEffect(() => { readyRef.current = ready; }, [ready]);

  // Rows resizing above the reader (an estimate corrected on first measure,
  // a card filling in) move everything below them, so scrollTop takes their
  // delta and the row at the top of the view stays put. The library applies
  // it in the same callback that moves the rows. Its default skips rows
  // re-measured while scrolling up, which is when the reader saw them shift.
  // At the end it keeps the distance to the end instead (scrollEndThreshold),
  // and during the initial placement the placement loop owns the position.
  useLayoutEffect(() => {
    virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item) => {
      const el = scrollRef.current;
      return readyRef.current && !!el && item.end <= el.scrollTop;
    };
  }, [virtualizer]);
  // the latest placement, for the fallback below to apply before revealing
  const placeRef = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    if (ready || !items.length) return;
    const saved = jumpIndex < 0 ? readingPositionFor(surfaceId, conversationId) : undefined;
    const savedIndex = saved && !saved.atEnd ? items.findIndex((item) => item.key === saved.key) : -1;
    const place = (measured: boolean) => {
      if (jumpIndex >= 0) {
        // the jump effect below centers it again once ready, and highlights it
        virtualizer.scrollToIndex(jumpIndex, { align: 'center' });
      } else if (savedIndex >= 0 && saved) {
        // back where the reader left it: the same row, the same distance in
        const start = measured ? virtualizer.measurementsCache[savedIndex]?.start : undefined;
        if (start !== undefined) virtualizer.scrollToOffset(start + saved.offset);
        else virtualizer.scrollToIndex(savedIndex, { align: 'start' });
      } else {
        virtualizer.scrollToIndex(items.length - 1, { align: 'end' });
      }
    };
    const atEndPlacement = jumpIndex < 0 && savedIndex < 0;
    placeRef.current = () => {
      place(true);
      const el = scrollRef.current;
      if (atEndPlacement && el) el.scrollTop = el.scrollHeight - el.clientHeight;
    };
    place(false);
    let frames = 0;
    let stableFrames = 0;
    let last = '';
    let lastTotalSize = -1;
    let handle = requestAnimationFrame(function settle() {
      place(true);
      const el = scrollRef.current;
      // "Still" is not enough at the end: WebKit can apply the virtualizer's
      // scroll a frame late, holding a few pixels short for two frames — the
      // list then appeared and slid down. The end is checked for real, and
      // written directly when it isn't there yet.
      const maxTop = el ? el.scrollHeight - el.clientHeight : 0;
      const reached = !atEndPlacement || !el || Math.abs(el.scrollTop - maxTop) <= 1;
      if (!reached && el) el.scrollTop = maxTop;
      const totalSize = virtualizer.getTotalSize();
      const sizeStill = !atEndPlacement || totalSize === lastTotalSize;
      lastTotalSize = totalSize;
      const now = `${el?.scrollTop}:${el?.scrollHeight}:${totalSize}`;
      stableFrames = reached && sizeStill && now === last ? stableFrames + 1 : 0;
      last = now;
      // not laid out yet (a hidden pane): nothing measured is real, so wait
      // without spending the frame budget
      if (el && el.clientHeight === 0) {
        handle = requestAnimationFrame(settle);
        return;
      }
      if (stableFrames < PLACEMENT_STABLE_FRAMES && ++frames < PLACEMENT_MAX_FRAMES) {
        handle = requestAnimationFrame(settle);
        return;
      }
      // the ref too, right away: a scroll landing before the effect above
      // syncs it would otherwise still be ignored as part of the placement
      readyRef.current = true;
      setReady(true);
    });
    return () => cancelAnimationFrame(handle);
  }, [ready, items, jumpIndex, virtualizer, surfaceId, conversationId]);

  // Your own send brings you back to the present, even from old history.
  const pendingCount = pending.length;
  const prevPendingCountRef = useRef(pendingCount);
  useEffect(() => {
    if (pendingCount > prevPendingCountRef.current) virtualizer.scrollToIndex(items.length - 1, { align: 'end' });
    prevPendingCountRef.current = pendingCount;
  }, [pendingCount, items.length, virtualizer]);

  const firstIndex = virtualItems[0]?.index ?? 0;
  const lastIndex = virtualItems[virtualItems.length - 1]?.index ?? 0;

  // After an older page lands, the virtualizer moves the scroll position to
  // keep the reader's row in place — in WebKit a frame or so after the
  // render. Asking for the next page in that gap (still "at the top") made
  // it anchor that page on the uncorrected position and lose the first
  // correction; so the next one waits until the position has settled.
  //
  // The virtualizer anchors on whatever row sits at the scroll offset, and at
  // the very top that is a date divider — which, unlike a message, moves: an
  // older page of the same day puts that day's divider in front of it. So the
  // first visible MESSAGE is tracked too, and after a prepend it is put back
  // exactly where it was if the virtualizer's own anchoring missed.
  const messageAnchorRef = useRef<{ key: string; offset: number } | null>(null);
  const itemsRef = useRef(items);
  const virtualizerRef = useRef(virtualizer);
  useLayoutEffect(() => { itemsRef.current = items; virtualizerRef.current = virtualizer; });
  const hasItems = items.length > 0;
  useEffect(() => {
    if (!hasItems) return;
    // Some mobile browsers do not run the initial measurement frame until
    // the user scrolls. A bounded fallback keeps the timeline from staying
    // invisible while the virtualizer waits for that frame.
    const timer = window.setTimeout(() => {
      if (readyRef.current || !scrollRef.current?.clientHeight) return;
      virtualizerRef.current.measure();
      // revealed where the placement would have ended, not wherever it was
      placeRef.current?.();
      scrollRef.current?.dispatchEvent(new Event('scroll'));
      readyRef.current = true;
      setReady(true);
    }, 750);
    return () => window.clearTimeout(timer);
  }, [hasItems, conversationId]);
  const captureMessageAnchor = useCallback(() => {
    const scrollTop = scrollRef.current?.scrollTop ?? 0;
    const row = virtualizer.getVirtualItems().find((v) => items[v.index]?.type === 'message' && v.end > scrollTop);
    messageAnchorRef.current = row ? { key: String(row.key), offset: scrollTop - row.start } : null;
  }, [virtualizer, items]);

  // the first MESSAGE, not the first item: a same-day older page leaves the
  // leading date divider's key unchanged
  const firstKey = items.find((item) => item.type === 'message')?.key;
  const prevFirstKeyRef = useRef(firstKey);

  const [settlingPrepend, setSettlingPrepend] = useState(false);
  const settlingRef = useRef(false);
  useEffect(() => { settlingRef.current = settlingPrepend; }, [settlingPrepend]);
  const captureMessageAnchorRef = useRef(captureMessageAnchor);
  useEffect(() => { captureMessageAnchorRef.current = captureMessageAnchor; }, [captureMessageAnchor]);
  useLayoutEffect(() => {
    if (firstKey === prevFirstKeyRef.current) return;
    prevFirstKeyRef.current = firstKey;
    const anchor = messageAnchorRef.current;
    setSettlingPrepend(true);
    let frames = 0;
    // latest items/measurements through refs: this must keep running across
    // the re-renders the prepend itself causes
    const restore = () => {
      if (!anchor) return;
      const index = itemsRef.current.findIndex((item) => item.key === anchor.key);
      const start = index >= 0 ? virtualizerRef.current.measurementsCache[index]?.start : undefined;
      if (start === undefined) return;
      const expected = start + anchor.offset;
      const el = scrollRef.current;
      // written to the element, not through the virtualizer: in WebKit its
      // scrollToOffset here left its own offset out of step with the real
      // one (it kept rendering the top rows); the native scroll event this
      // fires is what it listens to anyway
      if (el && Math.abs(el.scrollTop - expected) > 1) el.scrollTop = expected;
    };
    restore();
    let handle = requestAnimationFrame(function tick() {
      restore();
      if (++frames < PREPEND_SETTLE_FRAMES) { handle = requestAnimationFrame(tick); return; }
      setSettlingPrepend(false);
    });
    return () => cancelAnimationFrame(handle);
  }, [firstKey]);

  useEffect(() => {
    if (!ready || !items.length) return;
    if (firstIndex <= PAGE_TRIGGER_ROWS && hasMoreBefore && !isLoadingOlder && !settlingPrepend) loadOlderMessages(conversationId);
    if (lastIndex >= items.length - 1 - PAGE_TRIGGER_ROWS && hasMoreAfter && !isLoadingNewer) loadNewerMessages(conversationId);
  }, [ready, firstIndex, lastIndex, items.length, hasMoreBefore, hasMoreAfter, isLoadingOlder, isLoadingNewer, settlingPrepend, loadOlderMessages, loadNewerMessages, conversationId]);

  // Whether the new-messages line has scrolled out of view above the reader,
  // which puts up the "jump to first unread" pill.
  const [dividerAbove, setDividerAbove] = useState(false);
  const unreadIndexRef = useRef(unreadIndex);
  const updateDividerAbove = useCallback(() => {
    const el = scrollRef.current;
    const index = unreadIndexRef.current;
    const row = index >= 0 ? virtualizerRef.current.measurementsCache[index] : undefined;
    setDividerAbove(!!el && !!row && row.end <= el.scrollTop);
  }, []);
  useLayoutEffect(() => {
    unreadIndexRef.current = unreadIndex;
    if (ready) updateDividerAbove();
  }, [ready, unreadIndex, items, updateDividerAbove]);

  // "At the present" drives the new-messages pill: messages appended while
  // reading above are counted instead of yanking the view down.
  const [atEnd, setAtEnd] = useState(true);
  const [unseen, setUnseen] = useState(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const end = el.scrollHeight - el.scrollTop - el.clientHeight <= AT_END_THRESHOLD;
      setAtEnd(end);
      if (end) setUnseen(0);
      if (!readyRef.current) return;
      if (!settlingRef.current) captureMessageAnchorRef.current();
      updateDividerAbove();
      const top = virtualizer.getVirtualItemForOffset(el.scrollTop);
      if (top) saveReadingPosition(surfaceId, conversationId, { key: String(top.key), offset: el.scrollTop - top.start, atEnd: end });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [virtualizer, surfaceId, conversationId, updateDividerAbove]);
  // After scrollToIndex the library keeps steering to that row for up to 5 s,
  // until it lands there, and at the end the target moves with every row
  // that grows. The end placement, still chasing images loading on arrival,
  // pulled the reader's first scroll up back down; a gesture of theirs ends
  // it. Nothing public cancels it, so its pending target is dropped.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const takeOver = () => {
      if (readyRef.current) (virtualizer as unknown as { scrollState: unknown }).scrollState = null;
    };
    const onKeyDown = (event: KeyboardEvent) => { if (SCROLL_KEYS.has(event.key)) takeOver(); };
    el.addEventListener('wheel', takeOver, { passive: true });
    el.addEventListener('touchstart', takeOver, { passive: true });
    // grabbing the scrollbar
    el.addEventListener('pointerdown', takeOver);
    el.addEventListener('keydown', onKeyDown);
    return () => {
      el.removeEventListener('wheel', takeOver);
      el.removeEventListener('touchstart', takeOver);
      el.removeEventListener('pointerdown', takeOver);
      el.removeEventListener('keydown', onKeyDown);
    };
  }, [virtualizer]);
  const lastKey = items[items.length - 1]?.key;
  const prevLastKeyRef = useRef(lastKey);
  const prevLengthRef = useRef(items.length);
  useEffect(() => {
    const appended = ready && lastKey !== prevLastKeyRef.current && items.length > prevLengthRef.current;
    if (appended && !atEnd) setUnseen((count) => count + (items.length - prevLengthRef.current));
    // the library follows an append only when pinned; a reader a little
    // above the end still counts as at the present for new messages
    else if (appended && !hasMoreAfter) virtualizer.scrollToIndex(items.length - 1, { align: 'end' });
    prevLastKeyRef.current = lastKey;
    prevLengthRef.current = items.length;
  }, [lastKey, items.length, atEnd, ready, hasMoreAfter, virtualizer]);

  const highlight = useCallback((msgId: number) => {
    if (highlightTimeoutRef.current != null) window.clearTimeout(highlightTimeoutRef.current);
    setHighlightedMsgId(msgId);
    highlightTimeoutRef.current = window.setTimeout(() => setHighlightedMsgId(null), HIGHLIGHT_MS);
  }, []);

  /** By index in this list's own data, not a DOM lookup: the target may be
   * loaded but not mounted, and another surface may show the same rows. */
  const scrollToMessage = useCallback((msgId: number): boolean => {
    const index = items.findIndex((item) => item.type === 'message' && item.message.msgId === msgId);
    if (index < 0) return false;
    virtualizer.scrollToIndex(index, { align: 'center' });
    highlight(msgId);
    return true;
  }, [items, virtualizer, highlight]);

  const onJumpTo = useCallback((msgId: number) => {
    // not in this window: load one around it (then the effect below lands)
    if (!scrollToMessage(msgId)) jumpToMessage(conversationId, msgId);
  }, [scrollToMessage, jumpToMessage, conversationId]);

  useEffect(() => {
    if (!ready || !pendingJumpTarget || pendingJumpTarget.conversationId !== conversationId) return;
    if (scrollToMessage(pendingJumpTarget.msgId)) clearPendingJumpTarget();
  }, [ready, pendingJumpTarget, conversationId, scrollToMessage, clearPendingJumpTarget]);

  useEffect(() => () => {
    if (highlightTimeoutRef.current != null) window.clearTimeout(highlightTimeoutRef.current);
  }, []);

  const showJumpToUnread = ready && !isLoadingOlder && (dividerAbove || unreadInOlderPage);
  const jumpToFirstUnread = () => {
    if (unreadIndex >= 0) virtualizer.scrollToIndex(unreadIndex, { align: 'start' });
    // not loaded yet: a window around it, which opens on that message
    else if (firstUnreadId !== undefined) jumpToMessage(conversationId, firstUnreadId);
  };

  const newerCount = newerCountByConversation.get(conversationId) ?? 0;
  const pill = hasMoreAfter
    ? { label: newerCount ? `${newerCount} ${newerCount === 1 ? 'mensagem nova' : 'mensagens novas'} · voltar ao presente` : 'Voltar para o mais recente', onClick: () => openConversation(conversationId) }
    : !atEnd && unseen > 0
      ? { label: `${unseen} ${unseen === 1 ? 'mensagem nova' : 'mensagens novas'}`, onClick: () => virtualizer.scrollToIndex(items.length - 1, { align: 'end', behavior: 'smooth' }) }
      : null;

  return (
    <div className="relative min-h-0 flex-1">
      {/* overflow-anchor off: the virtualizer already keeps the reading
          position; the browser's own anchoring would compensate twice */}
      {/* data-settled: the initial placement is done and scrolls now count as
          reading — what anything waiting on the timeline should wait for */}
      <div ref={scrollRef} data-scroll-root data-settled={ready || undefined} className="h-full overflow-y-auto px-2 [overflow-anchor:none]">
        {isLoadingOlder && <p className="absolute inset-x-0 top-2 z-10 select-none text-center text-label text-text-muted">{t('timeline.loadingOlder')}</p>}
        {items.length === 0 ? (
          <div className="flex min-h-[45vh] select-none items-center justify-center px-6 text-center text-label text-text-muted">
            {historyArrived ? (
              <EmptyState
                illustration={conversation?.type === 'direct' ? 'bubble' : 'hash'}
                title={t('timeline.emptyTitle')}
                description={conversation && t(conversation.type === 'direct' ? 'timeline.emptyDirect' : 'timeline.emptyChannel', { name: conversationTitle(conversation, myUserId, allUsers) })}
              />
            ) : (
              // only shown if the history is slow: a quick one would flash it for a frame
              <span role="status" className="animate-in fade-in-0 duration-200 [animation-delay:300ms] [animation-fill-mode:both]">{t('timeline.loading')}</span>
            )}
          </div>
        ) : (
          // height and each row's transform belong to the virtualizer
          // (directDomUpdates): a render setting them could write back a stale value
          <div ref={virtualizer.containerRef} role="log" aria-label={t('timeline.log')} className="relative w-full" style={{ visibility: ready ? undefined : 'hidden' }}>
            {virtualItems.map((virtualItem) => {
              const item = items[virtualItem.index]!;
              return (
                <div
                  key={virtualItem.key}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  // flow-root keeps the row's own margins inside the box
                  // that gets measured, so spacing never drifts the math
                  className="absolute inset-x-0 top-0 flow-root"
                >
                  {item.type === 'date' ? (
                    <div className="my-4 flex select-none items-center gap-3 px-4">
                      <span aria-hidden className="h-px flex-1 bg-border-default" />
                      <span className="flex-none text-caption font-medium text-text-muted opacity-60">{item.label}</span>
                      <span aria-hidden className="h-px flex-1 bg-border-default" />
                    </div>
                  ) : item.type === 'unread' ? (
                    <div className="my-4 flex select-none items-center gap-3 px-4" role="separator" aria-label={t('timeline.newMessages')}>
                      <span aria-hidden className="h-px flex-1 bg-accent-text/45" />
                      <span className="flex-none text-caption font-semibold text-accent-text">{t('timeline.newMessages')}</span>
                      <span aria-hidden className="h-px flex-1 bg-accent-text/45" />
                    </div>
                  ) : (
                    <ArrivalMotion surfaceId={surfaceId} itemKey={item.key}>
                      <MessageRow
                        message={item.message}
                        showHeader={item.showHeader}
                        highlighted={highlightedMsgId === item.message.msgId}
                        pending={item.pending}
                        allUsers={allUsers}
                        mentionLookup={mentionLookup}
                        onReply={() => onReply(item.message)}
                        onOpenProfile={onOpenProfile}
                        onJumpTo={onJumpTo}
                      />
                    </ArrivalMotion>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {showJumpToUnread && (
        <button
          type="button"
          onClick={jumpToFirstUnread}
          className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-label font-medium text-primary-foreground shadow-popover"
        >
          <ArrowUpIcon size={14} weight="fill" />
          {t('timeline.jumpToFirstUnread')}
        </button>
      )}
      {pill && (
        <button
          type="button"
          onClick={pill.onClick}
          style={{ bottom: bottomPadding + 16 }}
          className="absolute left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-label font-medium text-primary-foreground shadow-popover"
        >
          <ArrowDownIcon size={14} weight="fill" />
          {pill.label}
        </button>
      )}
    </div>
  );
}
