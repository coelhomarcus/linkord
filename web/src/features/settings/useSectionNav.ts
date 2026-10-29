import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

// a section counts as reached once its top is within this many px of the
// scroller's top (SettingsSection's scroll-mt-20 is 80px, plus a little slack)
const REACHED_OFFSET = 96;
// a smooth scroll passes over every section on its way: the spy stays quiet
// this long so the chosen item doesn't flicker through the ones in between
const LOCK_MS = 700;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/** Which titled section of the open category is on screen (the last one whose
 * top has reached the scroller's top), and a way to scroll to one. */
export function useSectionNav(scrollerRef: RefObject<HTMLElement | null>, ids: readonly string[]) {
  const key = ids.join('|');
  // keyed by the category's sections, so another category starts at its first
  const [spy, setSpy] = useState<{ key: string; id: string | null }>({ key, id: ids[0] ?? null });
  const lockedUntil = useRef(0);
  const activeId = spy.key === key ? spy.id : (ids[0] ?? null);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || ids.length < 2) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      if (Date.now() < lockedUntil.current) return;
      const top = scroller.getBoundingClientRect().top;
      let current = ids[0] ?? null;
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top - top <= REACHED_OFFSET) current = id;
      }
      // the last sections may be too short to ever reach the top
      if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) current = ids[ids.length - 1] ?? current;
      setSpy({ key, id: current });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    schedule();
    scroller.addEventListener('scroll', schedule, { passive: true });
    return () => {
      scroller.removeEventListener('scroll', schedule);
      if (frame) cancelAnimationFrame(frame);
    };
    // `key` stands for `ids`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollerRef, key]);

  const goTo = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    lockedUntil.current = Date.now() + LOCK_MS;
    setSpy({ key, id });
    el.scrollIntoView?.({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    el.focus?.({ preventScroll: true });
  }, [key]);

  return { activeId, goTo };
}
