import { useEffect, useState } from 'react';

/** The clock, read again every `intervalMs` while the component shows. Kept in state, so the React
 * Compiler sees it change (a `Date.now()` in render would be computed once and kept). */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
