import { useCallback, useEffect, useState } from 'react';
import type { RefObject } from 'react';
import { useFullscreenElement } from '@/shared/hooks/useFullscreenElement';
import { enterFullscreen, exitFullscreen, fullscreenElement as currentFullscreenElement } from '@/shared/lib/fullscreen';

interface CallFullscreenApi {
  /** True specifically when THIS container (the call stage) is the
   * fullscreen element — a single tile going fullscreen (TileMenu's own
   * "Tela cheia") does not count as the call being expanded. */
  isCallFullscreen: boolean;
  toggleCallFullscreen: () => Promise<void>;
  /** Whatever element is ACTUALLY fullscreen right now, if any — the stage,
   * or a single tile. Menus/popovers portal into this instead of
   * `document.body`, which the Fullscreen API would otherwise render under. */
  fullscreenElement: HTMLElement | null;
}

/** Request fullscreen for the call view (the window's, in the desktop app: shared/lib/fullscreen.ts);
 * if unavailable or rejected, keep the expanded view usable. */
export function useCallFullscreen(containerRef: RefObject<HTMLElement | null>): CallFullscreenApi {
  const fullscreenElement = useFullscreenElement();
  // Compared in an effect, not inline during render — reading `.current`
  // synchronously in the render body is unsafe (React docs: refs are for
  // effects/handlers, not rendering).
  const [isCallFullscreen, setIsCallFullscreen] = useState(false);
  useEffect(() => {
    setIsCallFullscreen(fullscreenElement !== null && fullscreenElement === containerRef.current);
  }, [fullscreenElement, containerRef]);

  const toggleCallFullscreen = useCallback(async () => {
    if (currentFullscreenElement()) {
      await exitFullscreen();
      return;
    }
    const el = containerRef.current;
    if (el) await enterFullscreen(el);
  }, [containerRef]);

  return { isCallFullscreen, toggleCallFullscreen, fullscreenElement };
}
