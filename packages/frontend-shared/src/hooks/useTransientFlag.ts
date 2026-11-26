import { useCallback, useEffect, useState } from 'react';

/** A flag that turns itself off `durationMs` after it was raised, for short confirmations such as
 * "code sent again" (the default leaves time to read a couple of words). Raising it again while it is
 * on restarts the wait. Returns the flag, `raise` and `clear`. */
export function useTransientFlag(durationMs = 2200): [boolean, () => void, () => void] {
  const [state, setState] = useState<{ on: boolean; raises: number }>({ on: false, raises: 0 });

  useEffect(() => {
    if (!state.on) return;
    const timer = window.setTimeout(() => setState((current) => ({ ...current, on: false })), durationMs);
    return () => window.clearTimeout(timer);
  }, [state, durationMs]);

  const raise = useCallback(() => setState((current) => ({ on: true, raises: current.raises + 1 })), []);
  const clear = useCallback(() => setState((current) => ({ ...current, on: false })), []);
  return [state.on, raise, clear];
}
