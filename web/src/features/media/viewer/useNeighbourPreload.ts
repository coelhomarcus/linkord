import { useEffect } from 'react';
import { isWarmable, prefersSaveData, warmImage } from './viewerItem';
import type { ViewerItem } from './viewerItem';

/** The pictures on either side of the one shown, fetched ahead so stepping to them never shows an
 * empty frame. Still pictures only, and nothing under Save-Data. */
export function useNeighbourPreload(items: ViewerItem[], index: number, open: boolean): void {
  const previous = items[index - 1];
  const next = items[index + 1];
  const previousSrc = isWarmable(previous) ? previous.src : null;
  const nextSrc = isWarmable(next) ? next.src : null;
  useEffect(() => {
    if (!open || prefersSaveData()) return;
    if (nextSrc) warmImage(nextSrc);
    if (previousSrc) warmImage(previousSrc);
  }, [open, previousSrc, nextSrc]);
}
