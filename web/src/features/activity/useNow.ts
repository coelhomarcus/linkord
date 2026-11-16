import { useEffect, useState } from 'react';

/** The clock, read again every `intervalMs` while the component shows. Kept in state, so the React
 * Compiler sees it change (a `Date.now()` in render would be computed once and kept). The ticks fall on
 * the clock's own boundaries (each whole second for 1000), so two timers of the same activity on one
 * screen, mounted at different moments, still turn over together. */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        setNow(Date.now());
        schedule();
      }, intervalMs - (Date.now() % intervalMs));
    };
    schedule();
    return () => clearTimeout(timer);
  }, [intervalMs]);
  return now;
}
