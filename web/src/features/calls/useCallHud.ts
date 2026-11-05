import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

const IDLE_TIMEOUT_MS = 2500;
// Ignore small pointer movements so incidental jitter does not keep the controls visible.
// otimizar", applied conservatively here without a literal profiling pass).
const CHECK_INTERVAL_MS = 400;
const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'pointerdown', 'touchstart'] as const;

interface CallHudApi {
  hudVisible: boolean;
  /** Also whatever "activity" itself resolves to — exposed so a caller can
   * force a reveal from a non-DOM-event source (e.g. opening a menu
   * programmatically), though `suspend` covers the common case already. */
  revealHud: () => void;
}

/** Hide controls after inactivity; keep them visible while an action needs attention. */
export function useCallHud(suspend: boolean, hudRef?: RefObject<HTMLElement | null>): CallHudApi {
  const [hudVisible, setHudVisible] = useState(true);
  const lastActivityRef = useRef(Date.now());

  const revealHud = useCallback(() => {
    lastActivityRef.current = Date.now();
    setHudVisible(true);
  }, []);

  useEffect(() => {
    if (suspend) {
      setHudVisible(true);
      return;
    }
    revealHud();
    for (const ev of ACTIVITY_EVENTS) window.addEventListener(ev, revealHud, { passive: true });
    const interval = setInterval(() => {
      // The menu renders in a portal, so the bar fading out would leave it
      // floating on its own; while its trigger is expanded, the bar stays.
      if (hudRef?.current?.querySelector('[aria-expanded="true"]')) {
        lastActivityRef.current = Date.now();
        return;
      }
      if (Date.now() - lastActivityRef.current >= IDLE_TIMEOUT_MS) setHudVisible(false);
    }, CHECK_INTERVAL_MS);
    return () => {
      for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, revealHud);
      clearInterval(interval);
    };
  }, [suspend, revealHud, hudRef]);

  return { hudVisible, revealHud };
}
