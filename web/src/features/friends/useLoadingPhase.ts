import { useEffect, useRef, useState } from 'react';

// Long enough to read as a state: a skeleton swapped out after a frame or two
// would only flicker. A quick answer waits out the rest of this, no more.
const SKELETON_MIN_MS = 300;

export type LoadingPhase = 'skeleton' | 'content';

/** The skeleton from the first frame of a load, kept for at least
 * SKELETON_MIN_MS; then the content (or its error). */
export function useLoadingPhase(loading: boolean): LoadingPhase {
  // starts held when the view opens already loading, so its first frame is the skeleton
  const [held, setHeld] = useState(loading);
  const startedAt = useRef(0);

  useEffect(() => {
    if (loading) {
      startedAt.current = performance.now();
      const timer = setTimeout(() => setHeld(true));
      return () => clearTimeout(timer);
    }
    const timer = setTimeout(() => setHeld(false), Math.max(0, SKELETON_MIN_MS - (performance.now() - startedAt.current)));
    return () => clearTimeout(timer);
  }, [loading]);

  return loading || held ? 'skeleton' : 'content';
}
