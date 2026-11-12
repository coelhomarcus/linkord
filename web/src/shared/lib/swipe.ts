/** Shared numbers for the touch-first horizontal swipes (reply, the channel
 * list). `lockPx` is also the long-press drift tolerance: past this, that
 * press is already cancelled, and we may take the pointer if the move is
 * horizontal. */
export const SWIPE = {
  lockPx: 10,
  replyCommitPx: 56,
  replyMaxPx: 72,
  /** how wide a strip, after the iOS-back inset, still counts as an edge start */
  edgeHitPx: 28,
  /** iOS Safari's back-swipe; skipped unless the app is standalone */
  iosBackZonePx: 20,
  drawerCommitPx: 64,
} as const;

export type SwipeAxis = 'undecided' | 'horizontal' | 'vertical';

/** Decide the gesture from the displacement since pointerdown. Stays
 * undecided inside the lock so a tap and a long press are left alone;
 * the first axis to leave the lock wins, so a vertical scroll is never
 * claimed as a swipe. */
export function swipeAxis(dx: number, dy: number, lockPx = SWIPE.lockPx): SwipeAxis {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax <= lockPx && ay <= lockPx) return 'undecided';
  return ax > ay ? 'horizontal' : 'vertical';
}

/** Viewport X of a pointerdown that may open the channel list. On iOS
 * Safari the leftmost strip is the browser's back swipe, so we start
 * just inside it; a Home Screen app (and every other browser) can use
 * the real edge. */
export function edgeSwipeOriginX(input: { standalone: boolean; ios: boolean }): number {
  return (!input.standalone && input.ios) ? SWIPE.iosBackZonePx : 0;
}

export function isEdgeSwipeStart(clientX: number, originX: number, hitPx = SWIPE.edgeHitPx): boolean {
  return clientX >= originX && clientX < originX + hitPx;
}

/** Left-edge hit in the conversation panel's own coordinates. When the
 * panel is flush with the viewport, `originWhenFlush` skips iOS Safari's
 * back swipe; a tablet panel already sits past the rail. */
export function isConversationEdgeStart(clientX: number, panelLeft: number, originWhenFlush: number, hitPx = SWIPE.edgeHitPx): boolean {
  const origin = panelLeft < 1 ? originWhenFlush : 0;
  return isEdgeSwipeStart(clientX - panelLeft, origin, hitPx);
}

export function conversationPanelLeft(target: EventTarget | null): number {
  const panel = target instanceof Element ? target.closest('[data-drawer-swipe]') : null;
  return panel?.getBoundingClientRect().left ?? 0;
}

export function clampSwipe(dx: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, dx));
}
