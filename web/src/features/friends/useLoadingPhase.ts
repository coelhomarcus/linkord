import { useEffect, useState } from 'react';

// A fast answer never shows a placeholder: it would only flash for a frame or
// two before the rows replace it. A slow one shows the skeleton long enough to
// read as a state rather than a flicker.
const SKELETON_DELAY_MS = 200;
const SKELETON_MIN_MS = 450;

export type LoadingPhase = 'wait' | 'skeleton' | 'content';

/** `wait`: still loading, too soon to show anything. `skeleton`: loading for a
 * while, or the data landed while the skeleton is still within its minimum time.
 * `content`: render the list (or its error). */
export function useLoadingPhase(loading: boolean): LoadingPhase {
  const [skeletonSince, setSkeletonSince] = useState<number | null>(null);

  useEffect(() => {
    if (loading) {
      if (skeletonSince !== null) return;
      const timer = setTimeout(() => setSkeletonSince(Date.now()), SKELETON_DELAY_MS);
      return () => clearTimeout(timer);
    }
    if (skeletonSince === null) return;
    const timer = setTimeout(() => setSkeletonSince(null), Math.max(0, SKELETON_MIN_MS - (Date.now() - skeletonSince)));
    return () => clearTimeout(timer);
  }, [loading, skeletonSince]);

  if (skeletonSince !== null) return 'skeleton';
  return loading ? 'wait' : 'content';
}
