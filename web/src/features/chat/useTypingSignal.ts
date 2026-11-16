import { useCallback, useRef } from 'react';

// How often notify actually emits typing:true while the user keeps typing
// (leading-edge: fires right away after being idle, then throttles), and how
// long without a keystroke before it emits typing:false on its own.
const TYPING_THROTTLE_MS = 3000;
const TYPING_IDLE_MS = 5000;

/** The composer's typing:true/false signal for one conversation. `stop` keeps
 * the conversation it was made for, so a cleanup that runs on a conversation
 * switch flushes typing:false to the one being left. */
export function useTypingSignal(conversationId: string, disabled: boolean, sendTyping: (conversationId: string, typing: boolean) => void) {
  const lastSentAtRef = useRef<number | null>(null); // Date.now() of the last emitted typing:true
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);

  const notify = useCallback(() => {
    if (disabled) return;
    const now = Date.now();
    if (!isTypingRef.current || lastSentAtRef.current === null || now - lastSentAtRef.current >= TYPING_THROTTLE_MS) {
      sendTyping(conversationId, true);
      lastSentAtRef.current = now;
      isTypingRef.current = true;
    }
    if (idleTimerRef.current !== null) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      isTypingRef.current = false;
      lastSentAtRef.current = null;
      sendTyping(conversationId, false);
    }, TYPING_IDLE_MS);
  }, [conversationId, disabled, sendTyping]);

  const stop = useCallback(() => {
    if (idleTimerRef.current !== null) { clearTimeout(idleTimerRef.current); idleTimerRef.current = null; }
    if (isTypingRef.current) sendTyping(conversationId, false);
    isTypingRef.current = false;
    lastSentAtRef.current = null;
  }, [conversationId, sendTyping]);

  return { notify, stop };
}
