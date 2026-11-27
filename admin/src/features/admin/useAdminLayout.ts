import { useLayoutEffect, useState, type RefObject } from 'react';

type AdminMode = 'wide' | 'compact';

export const ADMIN_WIDE_MIN = 960;

export function adminModeForWidth(width: number): AdminMode {
  if (width <= 0) return 'wide';
  return width >= ADMIN_WIDE_MIN ? 'wide' : 'compact';
}

/** Observes the shell so the navigation width cannot affect the breakpoint. */
export function useAdminLayout(ref: RefObject<HTMLElement | null>): AdminMode {
  const [mode, setMode] = useState<AdminMode>('wide');

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setMode(adminModeForWidth(el.getBoundingClientRect().width));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  return mode;
}
