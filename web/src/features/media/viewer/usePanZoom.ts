import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, SyntheticEvent } from 'react';
import { DURATION } from '@/shared/lib/ease';
import { swipeAxis } from '@/shared/lib/swipe';
import {
  REST, ZOOM, clampPan, distance, fitSize, footprint, fromCentre, isTap, isZoomed, midpoint, stepZoom, toggleZoom,
  wheelScaleFactor, zoomAt,
} from './panZoomMath';
import type { Point, Size, Transform } from './panZoomMath';

/** How far down a finger drags a picture at rest before letting go closes the viewer. */
export const DISMISS_PX = 96;
// a second tap this soon (and this close) after the first is a double tap
const DOUBLE_TAP_MS = 300;

interface PanZoomOptions {
  /** the picture's own size when known before it loads (stored with an upload) */
  naturalSize: Size | null;
  /** a new value starts again at rest, unturned */
  resetKey: string;
  enabled: boolean;
  /** a jump (button, key, double-click) lands at once instead of easing there */
  reducedMotion?: boolean;
  /** a finger dragging a picture at rest downwards: the distance, then whether it was let go far enough */
  onDismissMove?: (dy: number) => void;
  onDismiss?: () => void;
  /** a tap or click on the stage outside the picture */
  onBackdropTap?: () => void;
}

interface Gesture {
  pointers: Map<number, Point>;
  start: Point;
  startTransform: Transform;
  pinch: { distance: number; centre: Point; transform: Transform } | null;
  moved: boolean;
  /** a touch at rest: undecided until it leaves the swipe lock, then 'dismiss' or ignored */
  restAxis: 'undecided' | 'dismiss' | 'ignore';
  pointerType: string;
}

/** Zoom, pan and rotation for the viewer's picture: wheel at the cursor, pinch around the fingers'
 * centre, drag to pan (kept inside the edges), double-click or double tap to toggle, buttons and
 * keys through the returned controls. Horizontal swipes at rest are left to the caller
 * (useHorizontalSwipe), so changing item stays the app's one swipe. */
export function usePanZoom({ naturalSize, resetKey, enabled, reducedMotion = false, onDismissMove, onDismiss, onBackdropTap }: PanZoomOptions) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [stage, setStage] = useState<Size>({ width: 0, height: 0 });
  const [loadedSize, setLoadedSize] = useState<{ key: string; size: Size } | null>(null);
  const [transform, setTransformState] = useState<Transform>(REST);
  const [rotation, setRotation] = useState(0);
  // eased only for a jump (a button, a key, a double-click); a gesture follows the pointer exactly
  const [animate, setAnimate] = useState(false);
  const transformRef = useRef(transform);
  const gestureRef = useRef<Gesture | null>(null);
  const lastTapRef = useRef<{ at: number; point: Point } | null>(null);
  const suppressClickRef = useRef(false);
  const optionsRef = useRef({ onDismissMove, onDismiss, onBackdropTap });
  useEffect(() => { optionsRef.current = { onDismissMove, onDismiss, onBackdropTap }; });

  const natural = naturalSize ?? (loadedSize?.key === resetKey ? loadedSize.size : null);
  const laidOut = natural ? fitSize(natural, stage, rotation) : null;
  const picture = laidOut ? footprint(laidOut, rotation) : stage;
  // the gesture handlers read the latest limits without being remade on every frame
  const pictureRef = useRef(picture);
  const stageSizeRef = useRef(stage);
  useLayoutEffect(() => {
    transformRef.current = transform;
    pictureRef.current = picture;
    stageSizeRef.current = stage;
  });

  const setTransform = useCallback((next: Transform, eased: boolean) => {
    transformRef.current = next;
    setAnimate(eased);
    setTransformState(next);
  }, []);

  const [lastKey, setLastKey] = useState(resetKey);
  if (lastKey !== resetKey) {
    setLastKey(resetKey);
    setTransformState(REST);
    setRotation(0);
    setAnimate(false);
  }

  useLayoutEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    const measure = () => setStage({ width: element.clientWidth, height: element.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // a resize or a turn changes the limits: keep the picture inside them
  useEffect(() => {
    const current = transformRef.current;
    const clamped = clampPan(current, current.scale, picture, stage);
    if (clamped.x !== current.x || clamped.y !== current.y) setTransform({ ...current, ...clamped }, false);
  }, [picture.width, picture.height, stage.width, stage.height, setTransform]); // eslint-disable-line react-hooks/exhaustive-deps

  // React's wheel listener is passive, so preventing the page's own zoom/scroll needs our own
  useEffect(() => {
    const element = stageRef.current;
    if (!element || !enabled) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const current = transformRef.current;
      const anchor = fromCentre(event.clientX, event.clientY, element.getBoundingClientRect());
      const factor = wheelScaleFactor(event.deltaY, event.deltaMode, event.ctrlKey);
      setTransform(zoomAt(current, current.scale * factor, anchor, pictureRef.current, stageSizeRef.current), false);
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [enabled, setTransform]);

  const anchorOf = useCallback((clientX: number, clientY: number): Point => {
    const element = stageRef.current;
    return element ? fromCentre(clientX, clientY, element.getBoundingClientRect()) : { x: 0, y: 0 };
  }, []);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!enabled || event.button !== 0) return;
    const point = { x: event.clientX, y: event.clientY };
    const gesture = gestureRef.current;
    if (gesture) {
      gesture.pointers.set(event.pointerId, point);
      if (gesture.pointers.size === 2) {
        const [a, b] = [...gesture.pointers.values()] as [Point, Point];
        const centre = midpoint(a, b);
        gesture.pinch = { distance: distance(a, b), centre: anchorOf(centre.x, centre.y), transform: transformRef.current };
        gesture.moved = true;
        if (gesture.restAxis === 'dismiss') optionsRef.current.onDismissMove?.(0);
        gesture.restAxis = 'ignore';
      }
      return;
    }
    gestureRef.current = {
      pointers: new Map([[event.pointerId, point]]),
      start: point,
      startTransform: transformRef.current,
      pinch: null,
      moved: false,
      restAxis: 'undecided',
      pointerType: event.pointerType,
    };
  }, [enabled, anchorOf]);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || !gesture.pointers.has(event.pointerId)) return;
    gesture.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (gesture.pinch && gesture.pointers.size >= 2) {
      const [a, b] = [...gesture.pointers.values()] as [Point, Point];
      const ratio = distance(a, b) / Math.max(1, gesture.pinch.distance);
      const centre = midpoint(a, b);
      const anchor = anchorOf(centre.x, centre.y);
      const base = gesture.pinch.transform;
      const zoomed = zoomAt(base, base.scale * ratio, gesture.pinch.centre, pictureRef.current, stageSizeRef.current);
      // the fingers moving together also pan
      const panned = clampPan({ x: zoomed.x + anchor.x - gesture.pinch.centre.x, y: zoomed.y + anchor.y - gesture.pinch.centre.y }, zoomed.scale, pictureRef.current, stageSizeRef.current);
      setTransform({ scale: zoomed.scale, ...panned }, false);
      return;
    }

    const dx = event.clientX - gesture.start.x;
    const dy = event.clientY - gesture.start.y;
    if (!isTap(gesture.start, { x: event.clientX, y: event.clientY })) gesture.moved = true;

    if (isZoomed(gesture.startTransform)) {
      if (!gesture.moved) return;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      const start = gesture.startTransform;
      const panned = clampPan({ x: start.x + dx, y: start.y + dy }, start.scale, pictureRef.current, stageSizeRef.current);
      setTransform({ scale: start.scale, ...panned }, false);
      return;
    }

    // at rest, a finger dragged downwards pulls the picture away to close; sideways is the item swipe's
    if (gesture.pointerType === 'mouse') return;
    if (gesture.restAxis === 'undecided') {
      const axis = swipeAxis(dx, dy);
      if (axis === 'undecided') return;
      gesture.restAxis = axis === 'vertical' && dy > 0 ? 'dismiss' : 'ignore';
    }
    if (gesture.restAxis === 'dismiss') optionsRef.current.onDismissMove?.(Math.max(0, dy));
  }, [anchorOf, setTransform]);

  const endPointer = useCallback((event: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const gesture = gestureRef.current;
    if (!gesture || !gesture.pointers.has(event.pointerId)) return;
    gesture.pointers.delete(event.pointerId);
    if (gesture.pointers.size > 0) {
      // one finger of a pinch lifted: the other carries on as a pan from here
      if (gesture.pinch) {
        const [rest] = [...gesture.pointers.values()] as [Point];
        gesture.pinch = null;
        gesture.start = rest;
        gesture.startTransform = transformRef.current;
      }
      return;
    }
    gestureRef.current = null;
    if (gesture.moved) suppressClickRef.current = true;

    if (gesture.restAxis === 'dismiss') {
      const dy = event.clientY - gesture.start.y;
      optionsRef.current.onDismissMove?.(0);
      if (!cancelled && dy >= DISMISS_PX) optionsRef.current.onDismiss?.();
      return;
    }
    if (cancelled || gesture.moved || gesture.pointerType === 'mouse') return;

    // a touch that stayed put: a second one soon after, at the same spot, toggles zoom
    const now = performance.now();
    const point = { x: event.clientX, y: event.clientY };
    const last = lastTapRef.current;
    if (last && now - last.at < DOUBLE_TAP_MS && isTap(last.point, point)) {
      lastTapRef.current = null;
      setTransform(toggleZoom(transformRef.current, anchorOf(point.x, point.y), pictureRef.current, stageSizeRef.current), true);
      suppressClickRef.current = true;
      return;
    }
    lastTapRef.current = { at: now, point };
  }, [anchorOf, setTransform]);

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => endPointer(event, false), [endPointer]);
  const onPointerCancel = useCallback((event: ReactPointerEvent<HTMLDivElement>) => endPointer(event, true), [endPointer]);

  const onDoubleClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (!enabled) return;
    setTransform(toggleZoom(transformRef.current, anchorOf(event.clientX, event.clientY), pictureRef.current, stageSizeRef.current), true);
  }, [enabled, anchorOf, setTransform]);

  // a click on the stage outside the picture closes, as a lightbox's backdrop does
  const onClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    // the picture, the player and the stage's own controls are not the backdrop
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest('[data-viewer-content], button, a')) optionsRef.current.onBackdropTap?.();
  }, []);

  const onImageLoad = useCallback((event: SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth: width, naturalHeight: height } = event.currentTarget;
    if (width > 0 && height > 0) setLoadedSize({ key: resetKey, size: { width, height } });
  }, [resetKey]);

  const controls = {
    zoomIn: () => setTransform(stepZoom(transformRef.current, 1, picture, stage), true),
    zoomOut: () => setTransform(stepZoom(transformRef.current, -1, picture, stage), true),
    reset: () => { setTransform(REST, true); setRotation((degrees) => Math.round(degrees / 360) * 360); },
    rotate: (direction: 1 | -1) => { setAnimate(true); setRotation((degrees) => degrees + direction * 90); },
    /** an arrow key's worth of pan; false when nothing moved (already at that edge, or not zoomed) */
    panBy: (dx: number, dy: number): boolean => {
      const current = transformRef.current;
      if (!isZoomed(current)) return false;
      const next = clampPan({ x: current.x + dx, y: current.y + dy }, current.scale, picture, stage);
      setTransform({ ...current, ...next }, true);
      return true;
    },
  };

  const style: CSSProperties = {
    ...(laidOut && laidOut.width > 0 ? { width: laidOut.width, height: laidOut.height } : {}),
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale}) rotate(${rotation}deg)`,
    transition: animate && !reducedMotion ? `transform ${DURATION.settle}ms var(--ease-out-expo)` : 'none',
  };

  return {
    stageRef,
    stage,
    stageHandlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onDoubleClick, onClick },
    pictureStyle: style,
    onImageLoad,
    transform,
    rotation,
    zoomed: isZoomed(transform),
    rotated: rotation % 360 !== 0,
    controls,
    keyPanPx: ZOOM.keyPanPx,
  };
}
