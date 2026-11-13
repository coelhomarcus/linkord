import { useEffect, useState } from 'react';
import type { RefObject } from 'react';

/** Whether `ref` is inside the visible part of its scroll container (the chat
 * list, marked data-scroll-root; the viewport otherwise) right now. Unlike
 * useNearViewport it follows the element both ways: what animates only while
 * seen (a GIF) stops once it scrolls away. True where IntersectionObserver
 * does not exist, so nothing is held back for want of it. */
export function useInView(ref: RefObject<HTMLElement | null>, enabled = true): boolean {
  // starts as seen: a row usually mounts on screen, and a GIF that started still
  // would cost a second request a frame later
  const [inView, setInView] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) setInView(entry.isIntersecting);
    }, { root: el.closest('[data-scroll-root]') });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, enabled]);
  return inView;
}
