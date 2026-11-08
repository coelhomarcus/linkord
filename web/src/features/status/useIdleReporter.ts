import { useCallback, useEffect, useRef } from 'react';
import type { ClientMessage } from '@/shared/types/protocol';
import { useAutoIdleMinutes } from './autoIdlePreference';

const CHECK_EVERY_MS = 15_000;
const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'focus'] as const;

/** Tells the server when this tab has gone unused for the minutes set in settings, and when it is
 * used again. The server turns "online" into "idle" only once every tab and device of the account
 * says so. Only changes are sent; a fresh connection starts as active on the server, so after each
 * `welcome` an idle tab says so again (`onWelcome`). */
export function useIdleReporter({ sendWs }: { sendWs: (msg: ClientMessage) => boolean }) {
  const minutes = useAutoIdleMinutes();
  // stamped on mount (below): a render must not read the clock
  const lastActivityRef = useRef(0);
  const idleRef = useRef(false);

  const report = useCallback((idle: boolean) => {
    if (idleRef.current === idle) return;
    // only remembered once it was sent: a message lost to a dropped socket is sent again later
    if (sendWs({ t: 'presence-activity', idle })) idleRef.current = idle;
  }, [sendWs]);

  useEffect(() => {
    lastActivityRef.current = Date.now();
  }, []);

  useEffect(() => {
    const onActivity = () => {
      lastActivityRef.current = Date.now();
      if (idleRef.current) report(false);
    };
    for (const name of ACTIVITY_EVENTS) window.addEventListener(name, onActivity, { passive: true });
    return () => { for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, onActivity); };
  }, [report]);

  useEffect(() => {
    if (!minutes) {
      report(false);
      return;
    }
    const check = () => { if (Date.now() - lastActivityRef.current >= minutes * 60_000) report(true); };
    check();
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [minutes, report]);

  const onWelcome = useCallback(() => {
    const wasIdle = idleRef.current;
    idleRef.current = false;
    if (wasIdle) report(true);
  }, [report]);

  return { onWelcome };
}
