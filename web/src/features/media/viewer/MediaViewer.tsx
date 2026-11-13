import {
  ArrowClockwiseIcon, ArrowCounterClockwiseIcon, ArrowsInIcon, CaretLeftIcon, CaretRightIcon, MagnifyingGlassMinusIcon, MagnifyingGlassPlusIcon,
} from '@phosphor-icons/react';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { useReducedMotion } from 'motion/react';
import { useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useInRouterContext } from 'react-router';

import { useHorizontalSwipe } from '@/shared/hooks/useHorizontalSwipe';
import { TOUCH_FIRST_QUERY } from '@/shared/hooks/useLongPress';
import { useMediaQuery } from '@/shared/hooks/useMediaQuery';
import { placeholderDataUrl } from '@/shared/lib/placeholderImage';
import { cn } from '@/shared/lib/utils';
import { CloseButton } from '@/shared/ui/primitives/close-button';
import { VideoPlayer } from '../MediaPlayers';
import { useFinalFocus } from '../useFinalFocus';
import { BackButtonClose } from './BackButtonClose';
import { ZOOM } from './panZoomMath';
import { DISMISS_PX, usePanZoom } from './usePanZoom';
import { useNeighbourPreload } from './useNeighbourPreload';
import { ViewerActionBar, ViewerActionSheet } from './ViewerActions';
import { viewerIconButton } from './viewerStyles';
import type { ViewerAction } from './ViewerActions';
import { ViewerThumbnails } from './ViewerThumbnails';
import { isStill } from './viewerItem';
import type { ViewerItem } from './viewerItem';

export interface MediaViewerProps {
  items: ViewerItem[];
  index: number;
  open: boolean;
  onIndexChange: (index: number) => void;
  onOpenChange: (open: boolean) => void;
  /** what the set's owner adds (reply, jump to the message, delete) */
  extraActions?: ViewerAction[];
  /** rendered inside the viewer: dialogs those actions open, nested in this one */
  children?: ReactNode;
}

const navButton = 'grid size-11 place-items-center rounded-full bg-black/55 text-white transition-colors duration-100 ease-out-expo hover:bg-black/75 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-30 motion-reduce:transition-none';

/** The full-size viewer for a set of pictures, GIFs and videos — a message's, or the media panel's:
 * zoom, pan and rotation for pictures, the regular player for videos, a strip of every item, and the
 * item's actions. ImageLightbox stays separate: the profile screens depend on its single-image look. */
export function MediaViewer({ items, index, open, onIndexChange, onOpenChange, extraActions = [], children }: MediaViewerProps) {
  const { t } = useTranslation('media');
  const inRouter = useInRouterContext();
  const touchFirst = useMediaQuery(TOUCH_FIRST_QUERY);
  // the caller clears the set as it closes; the last one stays drawn while the viewer fades out
  const [shown, setShown] = useState({ items, index });
  if (open && items.length > 0 && (shown.items !== items || shown.index !== index)) setShown({ items, index });
  const list = open ? items : shown.items;
  const current = open ? index : shown.index;
  const item = list[current];
  const finalFocus = useFinalFocus(open);
  const keyHandlerRef = useRef<((event: KeyboardEvent<HTMLDivElement>) => void) | null>(null);
  useNeighbourPreload(list, current, open);

  const label = item
    ? (list.length > 1 ? t('collection.itemPosition', { name: item.name, index: current + 1, total: list.length }) : item.name)
    : t('collection.image');

  return (
    <DialogPrimitive.Root open={open && !!item} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/90 motion-modal data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Popup
          finalFocus={finalFocus}
          aria-label={label}
          data-media-viewer=""
          className="fixed inset-0 z-50 flex flex-col outline-none motion-modal data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
          onClick={() => onOpenChange(false)}
          // on the popup, which holds focus while open: a window listener loses to handlers elsewhere
          // in the app that stop propagation
          onKeyDown={(event) => keyHandlerRef.current?.(event)}
        >
          {item && (
            <ViewerBody
              items={list}
              index={current}
              item={item}
              touchFirst={touchFirst}
              extraActions={extraActions}
              keyHandlerRef={keyHandlerRef}
              onIndexChange={onIndexChange}
              onClose={() => onOpenChange(false)}
            />
          )}
          {children}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
      {inRouter && touchFirst && <BackButtonClose open={open && !!item} onClose={() => onOpenChange(false)} />}
    </DialogPrimitive.Root>
  );
}

interface ViewerBodyProps {
  items: ViewerItem[];
  index: number;
  item: ViewerItem;
  touchFirst: boolean;
  extraActions: ViewerAction[];
  keyHandlerRef: React.RefObject<((event: KeyboardEvent<HTMLDivElement>) => void) | null>;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}

function ViewerBody({ items, index, item, touchFirst, extraActions, keyHandlerRef, onIndexChange, onClose }: ViewerBodyProps) {
  const { t } = useTranslation('media');
  const reducedMotion = !!useReducedMotion();
  const still = isStill(item);
  const hasPrev = index > 0;
  const hasNext = index < items.length - 1;
  const [swipeDx, setSwipeDx] = useState(0);
  const [dismissDy, setDismissDy] = useState(0);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  const {
    stageRef, stage, stageHandlers, pictureStyle, onImageLoad, transform, rotated, zoomed, controls, keyPanPx,
  } = usePanZoom({
    naturalSize: item.width && item.height ? { width: item.width, height: item.height } : null,
    resetKey: item.key,
    enabled: still,
    reducedMotion,
    onDismissMove: (dy) => { if (!reducedMotion) setDismissDy(dy); },
    onDismiss: onClose,
    onBackdropTap: onClose,
  });

  const go = (next: number) => {
    if (next >= 0 && next < items.length && next !== index) onIndexChange(next);
  };

  const swipe = useHorizontalSwipe({
    enabled: touchFirst && !zoomed && items.length > 1,
    direction: 'either',
    // the player's own controls keep their drags (the timeline, the volume)
    shouldStart: (event) => !(event.target instanceof Element && event.target.closest('button, [role="slider"], [data-video-controls]')),
    onMove: (dx) => { if (!reducedMotion) setSwipeDx(dx); },
    onEnd: (dx, committed) => {
      setSwipeDx(0);
      if (committed) go(dx < 0 ? index + 1 : index - 1);
    },
  });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    // keys from a menu or a dialog opened over the viewer arrive here through React's tree, not the DOM's
    if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
    const pan = keyPanPx;
    let handled = true;
    switch (event.key) {
      case 'ArrowLeft': if (!(still && controls.panBy(pan, 0)) && !zoomed) go(index - 1); break;
      case 'ArrowRight': if (!(still && controls.panBy(-pan, 0)) && !zoomed) go(index + 1); break;
      case 'ArrowUp': handled = still && controls.panBy(0, pan); break;
      case 'ArrowDown': handled = still && controls.panBy(0, -pan); break;
      case '+': case '=': if (still) controls.zoomIn(); else handled = false; break;
      case '-': case '_': if (still) controls.zoomOut(); else handled = false; break;
      case '0': if (still) controls.reset(); else handled = false; break;
      case 'r': case 'R': if (still) controls.rotate(event.shiftKey ? -1 : 1); else handled = false; break;
      default: handled = false;
    }
    if (handled) event.preventDefault();
  };
  useLayoutEffect(() => { keyHandlerRef.current = onKeyDown; });

  const placeholder = loadedKey === item.key ? null : placeholderDataUrl(item.placeholder ?? undefined);
  const contentTransform = swipeDx || dismissDy ? `translate3d(${swipeDx}px, ${dismissDy}px, 0)` : undefined;
  const sized = !!pictureStyle.width;

  return (
    <>
      <DialogPrimitive.Title className="sr-only">{item.name}</DialogPrimitive.Title>
      <div
        className="flex flex-none items-center gap-1 pb-2 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] pt-[max(0.75rem,env(safe-area-inset-top))] text-white"
        onClick={(event) => event.stopPropagation()}
      >
        <span className="min-w-0 flex-1 truncate text-label">{item.name}</span>
        {items.length > 1 && <span className="mr-2 flex-none text-label tabular-nums text-white/70">{index + 1} / {items.length}</span>}
        {touchFirst
          ? <ViewerActionSheet item={item} extraActions={extraActions} />
          : <ViewerActionBar item={item} extraActions={extraActions} />}
        <DialogPrimitive.Close render={<CloseButton variant="surface" size="md" className="ml-1" />} />
      </div>

      <div
        ref={stageRef}
        data-viewer-stage=""
        {...stageHandlers}
        onPointerDown={(event) => { swipe.onPointerDown(event); stageHandlers.onPointerDown(event); }}
        onClickCapture={swipe.onClickCapture}
        className={cn(
          'relative min-h-0 flex-1 touch-none select-none overflow-hidden',
          still && (zoomed ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in'),
        )}
      >
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ transform: contentTransform, opacity: dismissDy ? Math.max(0.3, 1 - dismissDy / (DISMISS_PX * 3)) : undefined }}
        >
          {still ? (
            <img
              key={item.key}
              data-viewer-content=""
              src={item.src}
              alt={item.name}
              draggable={false}
              data-download-url={item.originalSrc}
              data-download-name={item.name}
              onLoad={(event) => { setLoadedKey(item.key); onImageLoad(event); }}
              style={{
                ...pictureStyle,
                ...(placeholder ? { backgroundImage: `url(${placeholder})`, backgroundSize: 'cover' } : {}),
              }}
              className={cn('flex-none rounded-md object-contain shadow-popover will-change-transform', !sized && 'max-h-full max-w-full')}
            />
          ) : (
            <div data-viewer-content="" className="max-h-full max-w-full" onClick={(event) => event.stopPropagation()}>
              <VideoPlayer
                key={item.key}
                src={item.src}
                title={item.name}
                width={item.width}
                height={item.height}
                // before the stage is measured (its first frame), the window stands in
                fit={stage.width > 0 ? { maxWidth: stage.width, maxHeight: stage.height } : { maxWidth: window.innerWidth, maxHeight: window.innerHeight * 0.7 }}
                startAt={item.startAt}
                autoPlay
                className="border-white/10 shadow-popover"
              />
            </div>
          )}
        </div>
        {items.length > 1 && !touchFirst && (
          <>
            <button type="button" aria-label={t('collection.previous')} disabled={!hasPrev} onClick={() => go(index - 1)} className={`${navButton} absolute left-2 top-1/2 -translate-y-1/2 sm:left-4`}>
              <CaretLeftIcon size={22} aria-hidden />
            </button>
            <button type="button" aria-label={t('collection.next')} disabled={!hasNext} onClick={() => go(index + 1)} className={`${navButton} absolute right-2 top-1/2 -translate-y-1/2 sm:right-4`}>
              <CaretRightIcon size={22} aria-hidden />
            </button>
          </>
        )}
      </div>

      <div
        className="flex flex-none flex-col items-center gap-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] pt-2"
        onClick={(event) => event.stopPropagation()}
      >
        {still && (
          <div role="toolbar" aria-label={t('viewer.zoomControls')} className="flex items-center gap-0.5 rounded-full bg-black/55 px-1 py-0.5 text-white">
            <button type="button" aria-label={t('viewer.zoomOut')} title={t('viewer.zoomOut')} disabled={!zoomed} onClick={controls.zoomOut} className={viewerIconButton}>
              <MagnifyingGlassMinusIcon size={18} aria-hidden />
            </button>
            <span aria-live="off" data-viewer-zoom="" className="w-12 select-none text-center text-caption tabular-nums text-white/80">
              {Math.round(transform.scale * 100)}%
            </span>
            <button type="button" aria-label={t('viewer.zoomIn')} title={t('viewer.zoomIn')} disabled={transform.scale >= ZOOM.max} onClick={controls.zoomIn} className={viewerIconButton}>
              <MagnifyingGlassPlusIcon size={18} aria-hidden />
            </button>
            <button type="button" aria-label={t('viewer.reset')} title={t('viewer.reset')} disabled={!zoomed && !rotated} onClick={controls.reset} className={viewerIconButton}>
              <ArrowsInIcon size={18} aria-hidden />
            </button>
            <span aria-hidden className="mx-0.5 h-5 w-px bg-white/20" />
            <button type="button" aria-label={t('viewer.rotateLeft')} title={t('viewer.rotateLeft')} onClick={() => controls.rotate(-1)} className={viewerIconButton}>
              <ArrowCounterClockwiseIcon size={18} aria-hidden />
            </button>
            <button type="button" aria-label={t('viewer.rotateRight')} title={t('viewer.rotateRight')} onClick={() => controls.rotate(1)} className={viewerIconButton}>
              <ArrowClockwiseIcon size={18} aria-hidden />
            </button>
          </div>
        )}
        {items.length > 1 && <ViewerThumbnails items={items} index={index} onSelect={go} />}
      </div>
    </>
  );
}
