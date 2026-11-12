import { useCallback, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { useMediaQuery } from '@/shared/hooks/useMediaQuery';
import { useHorizontalSwipe } from '@/shared/hooks/useHorizontalSwipe';
import { TOUCH_FIRST_QUERY } from '@/shared/hooks/useLongPress';
import { lightHaptic } from '@/shared/lib/haptic';
import { conversationPanelLeft, edgeSwipeOriginX, isConversationEdgeStart, clampSwipe, SWIPE } from '@/shared/lib/swipe';
import { isIOSDevice, isStandaloneDisplay } from '@/shared/lib/displayMode';

const INTERACTIVE = 'a, button, input, textarea, select, [contenteditable="true"]';

export function useSwipeToReply(options: { enabled: boolean; onReply: () => void }) {
  const touchFirst = useMediaQuery(TOUCH_FIRST_QUERY);
  const reduceMotion = useReducedMotion();
  const [offset, setOffset] = useState(0);
  const enabled = touchFirst && options.enabled;

  const shouldStart = useCallback((event: { clientX: number; target: EventTarget | null }) => {
    if (event.target instanceof Element && event.target.closest(INTERACTIVE)) return false;
    // the left edge is the channel-list swipe; a message there must not take it
    const origin = edgeSwipeOriginX({ standalone: isStandaloneDisplay(), ios: isIOSDevice() });
    if (isConversationEdgeStart(event.clientX, conversationPanelLeft(event.target), origin)) return false;
    return true;
  }, []);

  const swipe = useHorizontalSwipe({
    enabled,
    direction: 'right',
    commitPx: SWIPE.replyCommitPx,
    shouldStart,
    onMove(dx) {
      if (reduceMotion) {
        setOffset(dx >= SWIPE.replyCommitPx ? SWIPE.replyMaxPx : 0);
        return;
      }
      setOffset(clampSwipe(dx, 0, SWIPE.replyMaxPx));
    },
    onEnd(_dx, committed) {
      setOffset(0);
      if (!committed) return;
      lightHaptic();
      options.onReply();
    },
  });

  return {
    enabled,
    offset,
    armed: offset >= SWIPE.replyCommitPx,
    handlers: enabled ? swipe : {},
  };
}
