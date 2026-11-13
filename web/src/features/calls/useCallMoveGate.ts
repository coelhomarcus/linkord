import { useCallback, useEffect, useRef, useState } from 'react';

/** A request to enter a call; `replace` tells the server the person agreed to move the account's call here. */
export type CallAttempt = (replace: boolean) => void;

/** Asks before a call request takes the account's call away from another tab or device. A request
 * goes out at once when nothing is held elsewhere; otherwise it waits for `confirm`. If the server
 * still refuses it (the other tab joined meanwhile), `onRefused` puts the same request up for
 * confirmation. */
export function useCallMoveGate(heldElsewhere: () => boolean) {
  const [open, setOpen] = useState(false);
  const pendingRef = useRef<CallAttempt | null>(null);
  const lastSentRef = useRef<CallAttempt | null>(null);
  const heldElsewhereRef = useRef(heldElsewhere);
  useEffect(() => { heldElsewhereRef.current = heldElsewhere; });

  const ask = useCallback((attempt: CallAttempt) => {
    pendingRef.current = attempt;
    setOpen(true);
  }, []);

  const request = useCallback((attempt: CallAttempt) => {
    if (heldElsewhereRef.current()) {
      lastSentRef.current = null;
      ask(attempt);
      return;
    }
    lastSentRef.current = attempt;
    attempt(false);
  }, [ask]);

  const onRefused = useCallback((): boolean => {
    const attempt = lastSentRef.current;
    lastSentRef.current = null;
    if (!attempt) return false;
    ask(attempt);
    return true;
  }, [ask]);

  const confirm = useCallback(() => {
    const attempt = pendingRef.current;
    pendingRef.current = null;
    setOpen(false);
    attempt?.(true);
  }, []);

  const cancel = useCallback(() => {
    pendingRef.current = null;
    setOpen(false);
  }, []);

  return { open, request, confirm, cancel, onRefused };
}
