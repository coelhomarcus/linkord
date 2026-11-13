import { prefersSaveData, warmImage } from './viewerItem';

/** How long a pointer rests on a thumbnail before its full picture is fetched: long enough that
 * sweeping across a history full of pictures fetches nothing. */
export const HOVER_WARM_DELAY_MS = 220;

// one pointer hovers one thing at a time, so one timer serves every thumbnail
let timer: number | null = null;

function cancel() {
  if (timer !== null) window.clearTimeout(timer);
  timer = null;
}

/** Spread on a thumbnail: once the mouse has rested on it, the full picture it opens is fetched, so
 * the viewer opens on it already loaded. Not under Save-Data, not for an animated picture (a GIF
 * would be decoded whole for nothing), and not for a finger, whose pointerenter is the tap itself. */
export function hoverWarmHandlers(src: string | null | undefined, { animated = false }: { animated?: boolean } = {}) {
  return {
    onPointerEnter: (event: { pointerType: string }) => {
      cancel();
      if (!src || animated || event.pointerType !== 'mouse' || prefersSaveData()) return;
      timer = window.setTimeout(() => {
        timer = null;
        warmImage(src);
      }, HOVER_WARM_DELAY_MS);
    },
    onPointerLeave: cancel,
  };
}
