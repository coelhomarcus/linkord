import { useEffect, useRef } from 'react';
import type { MouseEvent, PointerEvent, SyntheticEvent, TouchEvent } from 'react';

import { isPhoneLayout } from './phoneLayout';

// long enough that a tap or the start of a scroll never trips it
export const LONG_PRESS_MS = 450;
// a finger drifts a little while held still; more than this is a scroll
const MOVE_TOLERANCE_PX = 10;
// the click a browser may send for the lifted finger comes right after it
const RELEASE_CLICK_MS = 250;

/** A finger held on a message, on the phone layout: Discord's way into a
 * message's actions, where there is no hover toolbar and no right click.
 *
 * The app-wide context menu (GlobalContextMenu) has its own long press, and
 * Android also fires a native `contextmenu` for one: both are stopped at the
 * row, so the sheet is the only thing that opens. The tap that ends a long
 * press is swallowed too, or it would also follow whatever is under the
 * finger (a link, an image). */
/** React carries events up from portals: the sheet a long press opens is drawn
 * outside the row, yet its taps arrive here too, and none of them is a press on
 * the message. */
function fromRow(event: SyntheticEvent): boolean {
  return event.target instanceof Node && event.currentTarget.contains(event.target);
}

export function useLongPress(onLongPress: () => void) {
  const timerRef = useRef<number | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const firedRef = useRef(false);
  // when the finger that fired came off: only a click right then is that finger's
  const releasedAtRef = useRef(0);
  // a right click in a narrow desktop window keeps its menu: only a finger's is replaced
  const touchedRef = useRef(false);
  const callbackRef = useRef(onLongPress);
  useEffect(() => { callbackRef.current = onLongPress; }, [onLongPress]);

  const cancel = () => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    startRef.current = null;
  };
  useEffect(() => cancel, []);

  return {
    onPointerDown(event: PointerEvent) {
      if (!fromRow(event)) return;
      touchedRef.current = event.pointerType === 'touch';
      if (!touchedRef.current || !isPhoneLayout()) return;
      cancel();
      firedRef.current = false;
      startRef.current = { x: event.clientX, y: event.clientY };
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        firedRef.current = true;
        navigator.vibrate?.(10);
        callbackRef.current();
      }, LONG_PRESS_MS);
    },
    onPointerMove(event: PointerEvent) {
      if (!fromRow(event)) return;
      const start = startRef.current;
      if (!start || timerRef.current == null) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > MOVE_TOLERANCE_PX) cancel();
    },
    onPointerUp(event: PointerEvent) {
      if (!fromRow(event)) return;
      if (firedRef.current) releasedAtRef.current = Date.now();
      cancel();
    },
    // the browser takes the touch over for a scroll
    onPointerCancel: cancel,
    onTouchStart(event: TouchEvent) {
      if (isPhoneLayout()) event.stopPropagation();
    },
    onContextMenu(event: MouseEvent) {
      if (!touchedRef.current || !isPhoneLayout()) return;
      event.preventDefault();
      event.stopPropagation();
    },
    onClickCapture(event: MouseEvent) {
      if (!firedRef.current) return;
      firedRef.current = false;
      // Only the click that comes right as the finger lifts, wherever it
      // lands: on the message, or on the backdrop of the sheet already open
      // under the finger, which it would close. A later tap inside the sheet
      // is a real one and goes through.
      if (Date.now() - releasedAtRef.current > RELEASE_CLICK_MS) return;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}
