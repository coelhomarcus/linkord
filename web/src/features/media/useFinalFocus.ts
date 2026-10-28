import { useEffect, useRef } from 'react';

// How the last input arrived, to know whether a viewer was opened with the
// pointer. One listener pair for every viewer on the page (each chat
// attachment mounts one).
let lastInput: 'pointer' | 'keyboard' = 'keyboard';
let tracking = false;
function trackLastInput() {
  if (tracking || typeof document === 'undefined') return;
  tracking = true;
  document.addEventListener('pointerdown', () => { lastInput = 'pointer'; }, true);
  document.addEventListener('keydown', () => { lastInput = 'keyboard'; }, true);
}

/** The `finalFocus` of a full-screen viewer. Closing hands focus back to what
 * opened it; after a mouse click that leaves the message's hover toolbar
 * showing for as long as the thumbnail holds focus, as if the pointer were
 * still over it. Only a keyboard user, who needs to find their place again,
 * gets the focus back. */
export function useFinalFocus(open: boolean): () => boolean {
  const openedByPointer = useRef(false);
  useEffect(() => { trackLastInput(); }, []);
  useEffect(() => { if (open) openedByPointer.current = lastInput === 'pointer'; }, [open]);
  return () => !openedByPointer.current;
}
