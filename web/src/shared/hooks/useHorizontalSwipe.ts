import { useCallback, useEffect, useRef } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { SWIPE, swipeAxis } from '@/shared/lib/swipe';

const SWIPE_POINTER_TYPES = ['touch', 'pen'] as const;

export interface HorizontalSwipeOptions {
  enabled?: boolean;
  /** Which way the finger must travel after the lock. The other way aborts;
   * `either` takes both (the media viewer's previous/next). */
  direction: 'left' | 'right' | 'either';
  commitPx?: number;
  shouldStart?: (event: PointerEvent | ReactPointerEvent<Element>) => boolean;
  onMove?: (dx: number) => void;
  onEnd?: (dx: number, committed: boolean) => void;
  /** Listen for pointerdown on window (the channel-list close swipe, which
   * starts on the portaled sheet). Open swipes bind the returned handlers. */
  listenOnWindow?: boolean;
}

/**
 * A horizontal swipe that does not fight scrolling or the app's long press.
 * Movement inside `SWIPE.lockPx` is ignored (the press still owns it). The
 * first axis to leave that box wins: vertical lets the browser scroll
 * (`pointercancel` is left alone); horizontal captures the pointer. A
 * claimed swipe swallows the click that may follow.
 */
export function useHorizontalSwipe(options: HorizontalSwipeOptions) {
  const optionsRef = useRef(options);
  useEffect(() => { optionsRef.current = options; });
  const activeRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    claimed: boolean;
    target: Element | null;
    detach: () => void;
  } | null>(null);
  const swallowClickRef = useRef(false);

  const finish = useCallback((dx: number, committed: boolean) => {
    const active = activeRef.current;
    if (!active) return;
    activeRef.current = null;
    active.detach();
    if (active.claimed) {
      swallowClickRef.current = true;
      const swallow = (click: MouseEvent) => {
        click.preventDefault();
        click.stopPropagation();
      };
      window.addEventListener('click', swallow, { capture: true, once: true });
    }
    optionsRef.current.onMove?.(0);
    optionsRef.current.onEnd?.(dx, committed);
  }, []);

  const abort = useCallback(() => {
    const active = activeRef.current;
    if (!active) return;
    activeRef.current = null;
    active.detach();
    optionsRef.current.onMove?.(0);
    if (active.claimed) {
      swallowClickRef.current = true;
      optionsRef.current.onEnd?.(0, false);
    }
  }, []);

  const begin = useCallback((event: PointerEvent | ReactPointerEvent<Element>, currentTarget: EventTarget | null) => {
    const current = optionsRef.current;
    if (!current.enabled || event.button !== 0) return;
    if (!SWIPE_POINTER_TYPES.includes(event.pointerType as typeof SWIPE_POINTER_TYPES[number])) return;
    if (activeRef.current) {
      if (activeRef.current.pointerId !== event.pointerId) abort();
      return;
    }
    if (current.shouldStart && !current.shouldStart(event)) return;
    const pointerId = event.pointerId;
    const originX = event.clientX;
    const originY = event.clientY;
    const captureOn = currentTarget instanceof Element ? currentTarget : null;

    const preventTouch = (touch: TouchEvent) => {
      if (!activeRef.current?.claimed) return;
      touch.preventDefault();
    };

    const onMove = (move: PointerEvent) => {
      const active = activeRef.current;
      if (!active || move.pointerId !== pointerId) return;
      const dx = move.clientX - active.x;
      const dy = move.clientY - active.y;
      if (!active.claimed) {
        const axis = swipeAxis(dx, dy);
        if (axis === 'undecided') return;
        if (axis === 'vertical') {
          abort();
          return;
        }
        const wanted = current.direction === 'either' || (current.direction === 'right' ? dx > 0 : dx < 0);
        if (!wanted) {
          abort();
          return;
        }
        active.claimed = true;
        captureOn?.setPointerCapture?.(pointerId);
        window.addEventListener('touchmove', preventTouch, { capture: true, passive: false });
      }
      move.preventDefault();
      optionsRef.current.onMove?.(dx);
    };
    const onUp = (up: PointerEvent) => {
      if (up.pointerId !== pointerId) return;
      const active = activeRef.current;
      if (!active) return;
      const dx = up.clientX - active.x;
      const commitPx = optionsRef.current.commitPx ?? SWIPE.drawerCommitPx;
      const { direction } = optionsRef.current;
      const travelled = direction === 'either' ? Math.abs(dx) : direction === 'right' ? dx : -dx;
      finish(dx, active.claimed && travelled >= commitPx);
    };
    const onCancel = (cancel: PointerEvent) => {
      if (cancel.pointerId === pointerId) abort();
    };
    const onOtherPointer = (down: PointerEvent) => {
      if (down.pointerId !== pointerId) abort();
    };

    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancel, true);
    window.addEventListener('pointerdown', onOtherPointer, true);
    const detach = () => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onCancel, true);
      window.removeEventListener('pointerdown', onOtherPointer, true);
      window.removeEventListener('touchmove', preventTouch, true);
    };
    activeRef.current = { pointerId, x: originX, y: originY, claimed: false, target: captureOn, detach };
  }, [abort, finish]);

  useEffect(() => () => abort(), [abort]);
  useEffect(() => { if (options.enabled === false) abort(); }, [abort, options.enabled]);

  useEffect(() => {
    if (!options.listenOnWindow || options.enabled === false) return;
    const onDown = (event: PointerEvent) => begin(event, event.target);
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [begin, options.enabled, options.listenOnWindow]);

  const onPointerDown = useCallback((event: ReactPointerEvent<Element>) => {
    if (optionsRef.current.listenOnWindow) return;
    begin(event, event.currentTarget);
  }, [begin]);

  const onClickCapture = useCallback((event: ReactMouseEvent<Element>) => {
    if (!swallowClickRef.current) return;
    swallowClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  return { onPointerDown, onClickCapture };
}
