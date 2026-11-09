import { useLayoutEffect, useRef, useState } from 'react';

/** Keeps what `open` hides mounted until its closing animation ends: render while `mounted`, put the
 * returned `ref` on the animated element and drive its exit from `open` (`data-closed`). Where nothing
 * animates (jsdom has no getAnimations) it unmounts in the same commit, so tests see it go at once. */
export function useExitPresence<T extends HTMLElement = HTMLDivElement>(open: boolean) {
  const ref = useRef<T>(null);
  const [wasOpen, setWasOpen] = useState(open);
  const [exiting, setExiting] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    setExiting(!open);
  }
  useLayoutEffect(() => {
    if (!exiting) return;
    const animations = ref.current?.getAnimations?.() ?? [];
    if (animations.length === 0) {
      setExiting(false);
      return;
    }
    let cancelled = false;
    void Promise.allSettled(animations.map((animation) => animation.finished)).then(() => { if (!cancelled) setExiting(false); });
    return () => { cancelled = true; };
  }, [exiting]);
  return { ref, mounted: open || exiting };
}
