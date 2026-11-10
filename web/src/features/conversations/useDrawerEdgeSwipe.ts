import { useCallback } from 'react';
import { useMediaQuery } from '@/shared/hooks/useMediaQuery';
import { useHorizontalSwipe } from '@/shared/hooks/useHorizontalSwipe';
import { TOUCH_FIRST_QUERY } from '@/shared/hooks/useLongPress';
import { edgeSwipeOriginX, isConversationEdgeStart, SWIPE } from '@/shared/lib/swipe';
import { isIOSDevice, isStandaloneDisplay } from '@/shared/lib/displayMode';

/** On a touch-first overlay layout, swipe from the left edge of a
 * conversation to open the channel/DM list, and swipe left to close it.
 * The header back button and the sheet backdrop still do the same. */
export function useDrawerEdgeSwipe(options: {
  enabled: boolean;
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  const touchFirst = useMediaQuery(TOUCH_FIRST_QUERY);
  const active = touchFirst && options.enabled;
  const originX = edgeSwipeOriginX({ standalone: isStandaloneDisplay(), ios: isIOSDevice() });

  const shouldOpen = useCallback((event: { clientX: number; currentTarget: EventTarget | null }) => {
    const left = event.currentTarget instanceof Element ? event.currentTarget.getBoundingClientRect().left : 0;
    return isConversationEdgeStart(event.clientX, left, originX);
  }, [originX]);

  const openSwipe = useHorizontalSwipe({
    enabled: active && !options.open,
    direction: 'right',
    commitPx: SWIPE.drawerCommitPx,
    shouldStart: shouldOpen,
    onEnd(_dx, committed) {
      if (committed) options.setOpen(true);
    },
  });

  useHorizontalSwipe({
    enabled: active && options.open,
    direction: 'left',
    commitPx: SWIPE.drawerCommitPx,
    listenOnWindow: true,
    onEnd(_dx, committed) {
      if (committed) options.setOpen(false);
    },
  });

  return active ? openSwipe : {};
}
