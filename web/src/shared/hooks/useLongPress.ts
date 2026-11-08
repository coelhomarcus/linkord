import { useCallback, useEffect, useRef } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';

/** iOS and Base UI open their context menus at about this point; Android's
 * own timeout is 400-500 ms. */
export const LONG_PRESS_DELAY_MS = 500;
/** How far a finger may drift before the press counts as a scroll or a drag. */
export const LONG_PRESS_TOLERANCE_PX = 10;
/** A device whose main input is a finger; the same query as the `touch-first`
 * CSS variant in styles/index.css. */
export const TOUCH_FIRST_QUERY = '(hover: none) and (pointer: coarse)';

export interface LongPress {
  target: Element;
  /** where the press started, in client coordinates */
  x: number;
  y: number;
  pointerType: string;
}

/** `tap`: released before the delay. `release`: released after it fired.
 * `cancel`: moved past the tolerance, scrolled, a second finger, the browser
 * took the pointer over (pointercancel), the window lost focus, or unmount. */
export type LongPressEnd = 'tap' | 'release' | 'cancel';

export interface LongPressOptions {
  onLongPress: (press: LongPress) => void;
  /** Return false to leave this pointer to the browser, for example a link
   * whose native long press should keep working. */
  shouldStart?: (event: ReactPointerEvent<Element>) => boolean;
  /** Runs on pointerdown, in the same event as the timer starts, so feedback
   * hung on it starts with the gesture and not a frame later. */
  onStart?: (press: LongPress) => void;
  onEnd?: (press: LongPress, end: LongPressEnd) => void;
  delay?: number;
  /** `Infinity` keeps the press alive however far the pointer travels. */
  tolerance?: number;
  /** Mouse is left out by default: a mouse has a right button. */
  pointerTypes?: readonly string[] | 'all';
  /** A press still waiting on its delay ends when anything scrolls under it. */
  cancelOnScroll?: boolean;
  /** Captures the pointer on the element, so a press that slides off still
   * ends on it. */
  capturePointer?: boolean;
  disabled?: boolean;
}

interface ActivePress extends LongPress {
  pointerId: number;
  fired: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  detach: () => void;
}

const DEFAULT_POINTER_TYPES = ['touch', 'pen'] as const;

function vibrate() {
  // Chrome refuses vibrate() (and logs it) before the page has had a tap;
  // iOS Safari has no vibrate at all.
  const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  if (activation && !activation.hasBeenActive) return;
  try { navigator.vibrate?.(10); } catch { /* not supported */ }
}

/** Whether a contextmenu event comes from a finger (Android Chrome and
 * Firefox fire one on a long press; iOS Safari never does). */
export function isTouchContextMenu(event: MouseEvent): boolean {
  const pointerType = (event as PointerEvent).pointerType;
  if (pointerType) return pointerType !== 'mouse';
  const capabilities = (event as MouseEvent & { sourceCapabilities?: { firesTouchEvents: boolean } }).sourceCapabilities;
  if (capabilities) return capabilities.firesTouchEvents;
  // Firefox: MouseEvent.MOZ_SOURCE_TOUCH
  return (event as MouseEvent & { mozInputSource?: number }).mozInputSource === 5;
}

/**
 * The app's one long-press gesture, on pointer events. A press starts on
 * pointerdown and fires after `delay` unless it ends first; the browser's own
 * touch contextmenu is swallowed while a press is ours, so Android does not
 * open a second menu (or its text and link menus) on top of ours.
 *
 * Scrolling ends a press three ways: the browser takes the pointer over and
 * sends pointercancel (it does for any pan the element's touch-action allows),
 * the finger moves past `tolerance`, or something scrolls under a finger that
 * holds still (momentum, new messages). The click that may follow a fired
 * press is swallowed, so a long press on a button does not also press it.
 */
export function useLongPress(options: LongPressOptions) {
  const optionsRef = useRef(options);
  useEffect(() => { optionsRef.current = options; });
  const pressRef = useRef<ActivePress | null>(null);
  const swallowClickRef = useRef(false);

  const finish = useCallback((end: LongPressEnd) => {
    const press = pressRef.current;
    if (!press) return;
    pressRef.current = null;
    if (press.timer) clearTimeout(press.timer);
    press.detach();
    optionsRef.current.onEnd?.(press, end);
  }, []);

  useEffect(() => () => finish('cancel'), [finish]);
  useEffect(() => { if (options.disabled) finish('cancel'); }, [finish, options.disabled]);

  const onPointerDown = useCallback((event: ReactPointerEvent<Element>) => {
    swallowClickRef.current = false;
    const current = optionsRef.current;
    const pointerTypes = current.pointerTypes ?? DEFAULT_POINTER_TYPES;
    if (pressRef.current) {
      // a second finger: a pinch, not a press
      if (pressRef.current.pointerId !== event.pointerId) finish('cancel');
      return;
    }
    if (current.disabled || event.button !== 0) return;
    if (pointerTypes !== 'all' && !pointerTypes.includes(event.pointerType)) return;
    if (!(event.target instanceof Element)) return;
    if (current.shouldStart && !current.shouldStart(event)) return;

    const delay = current.delay ?? LONG_PRESS_DELAY_MS;
    const tolerance = current.tolerance ?? LONG_PRESS_TOLERANCE_PX;
    const pointerId = event.pointerId;
    if (current.capturePointer) event.currentTarget.setPointerCapture?.(pointerId);

    const onMove = (move: PointerEvent) => {
      const press = pressRef.current;
      if (!press || move.pointerId !== pointerId || press.fired) return;
      if (Math.hypot(move.clientX - press.x, move.clientY - press.y) > tolerance) finish('cancel');
    };
    const onUp = (up: PointerEvent) => {
      if (up.pointerId !== pointerId) return;
      finish(pressRef.current?.fired ? 'release' : 'tap');
    };
    const onCancel = (cancel: PointerEvent) => { if (cancel.pointerId === pointerId) finish('cancel'); };
    const onOtherPointer = (down: PointerEvent) => { if (down.pointerId !== pointerId) finish('cancel'); };
    const onScroll = () => { if (!pressRef.current?.fired) finish('cancel'); };
    const onBlur = () => finish('cancel');
    const onNativeMenu = (menu: MouseEvent) => {
      if (!menu.isTrusted) return;
      menu.preventDefault();
      menu.stopImmediatePropagation();
    };
    // window, capture: before anything on document sees the native contextmenu
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancel, true);
    window.addEventListener('pointerdown', onOtherPointer, true);
    const watchScroll = current.cancelOnScroll ?? true;
    if (watchScroll) window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    window.addEventListener('blur', onBlur);
    window.addEventListener('contextmenu', onNativeMenu, true);
    const detach = () => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onCancel, true);
      window.removeEventListener('pointerdown', onOtherPointer, true);
      window.removeEventListener('scroll', onScroll, { capture: true });
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('contextmenu', onNativeMenu, true);
    };

    const press: ActivePress = {
      target: event.target, x: event.clientX, y: event.clientY, pointerType: event.pointerType,
      pointerId, fired: false, timer: null, detach,
    };
    press.timer = setTimeout(() => {
      press.timer = null;
      press.fired = true;
      swallowClickRef.current = true;
      vibrate();
      optionsRef.current.onLongPress(press);
    }, delay);
    pressRef.current = press;
    current.onStart?.(press);
  }, [finish]);

  const onClickCapture = useCallback((event: ReactMouseEvent<Element>) => {
    if (!swallowClickRef.current) return;
    swallowClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  return { onPointerDown, onClickCapture };
}
