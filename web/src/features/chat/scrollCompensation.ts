/** Whether a row changing size should move the scroll position by the same
 * amount, so what the reader is looking at stays where it is.
 *
 * The virtualizer's own rule skips every already-measured row while the user
 * scrolls backward, to avoid a cascade of corrections. In a chat that is
 * exactly when it hurts: scrolling up brings rows with images, embeds and
 * link cards into range, they finish loading above the fold, and without the
 * correction each one shoves the message being read downward. */
export function shouldCompensateResize({ itemStart, itemEnd, isFirstMeasure, scrollOffset }: {
  itemStart: number;
  itemEnd: number;
  isFirstMeasure: boolean;
  scrollOffset: number;
}): boolean {
  // the estimate→actual correction of a row that has never been measured
  // applies even when it spans the fold: the whole estimated block was above it
  if (isFirstMeasure) return itemStart < scrollOffset;
  // a row that spans the fold grows below the reader; shifting by its delta
  // would drag the view down with it
  return itemEnd <= scrollOffset;
}
