import { useEffect, useState, useSyncExternalStore } from 'react';

// How far this device's clock is from the server's. An activity's start is on the server's clock, so a
// timer read against a device clock that is hours off (a dual-boot PC keeping local time in the
// hardware clock is off by the time zone) shows every activity hours long. Set from each `welcome`.

let offsetMs = 0;
const listeners = new Set<() => void>();

// under this, the difference is the network's delay, not a wrong clock: timers do not jump on every reconnect
const DRIFT_MS = 1_000;

/** Takes the server's clock from a `welcome`; absent from servers before protocol 27, which leaves it as it was. */
export function syncServerClock(serverTime: number | undefined, now = Date.now()): void {
  if (typeof serverTime !== 'number' || !Number.isFinite(serverTime)) return;
  const next = serverTime - now;
  if (Math.abs(next - offsetMs) < DRIFT_MS) return;
  offsetMs = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

const getOffset = () => offsetMs;

/** The server's clock, read again every `intervalMs` while the component shows. Kept in state, so the
 * React Compiler sees it change (a `Date.now()` in render would be computed once and kept). The ticks
 * fall on the clock's own boundaries (each whole second for 1000), so two timers of the same activity
 * on one screen, mounted at different moments, still turn over together. */
export function useServerNow(intervalMs: number): number {
  const offset = useSyncExternalStore(subscribe, getOffset);
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
  return now + offset;
}
