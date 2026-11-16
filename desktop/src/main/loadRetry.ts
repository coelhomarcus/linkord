const FIRST_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;

/** Wait before reloading after the server could not be reached (attempt counts from 0). */
export function retryDelayMs(attempt: number): number {
  return Math.min(MAX_DELAY_MS, FIRST_DELAY_MS * 2 ** Math.max(0, attempt));
}

// net::ERR_ABORTED: a navigation replaced by another one, not a failure
const ABORTED = -3;

export function isLoadFailure(errorCode: number, isMainFrame: boolean): boolean {
  return isMainFrame && errorCode !== ABORTED;
}

// A page whose process dies is reloaded, but a page that dies as soon as it
// loads (a GPU driver fault, a bad deploy) would otherwise reload in a tight
// loop. Crashes are counted until the page has stayed up for a while; past a
// few in a row the app stops and shows a screen with a reload button.
export const MAX_CRASHES = 3;
export const HEALTHY_AFTER_MS = 30_000;

export interface CrashHistory {
  /** crashes since the page last stayed up HEALTHY_AFTER_MS */
  count: number;
  /** when the page last finished loading */
  loadedAt: number | null;
}

export const NO_CRASHES: CrashHistory = { count: 0, loadedAt: null };

export type CrashDecision = { kind: 'reload'; delayMs: number } | { kind: 'give-up' };

export function pageLoaded(history: CrashHistory, now: number): CrashHistory {
  return { ...history, loadedAt: now };
}

export function pageCrashed(history: CrashHistory, now: number): { history: CrashHistory; decision: CrashDecision } {
  const healthy = history.loadedAt !== null && now - history.loadedAt >= HEALTHY_AFTER_MS;
  const count = (healthy ? 0 : history.count) + 1;
  // Giving up starts the count over: a reload from the screen gets the same chances
  if (count > MAX_CRASHES) return { history: NO_CRASHES, decision: { kind: 'give-up' } };
  return { history: { count, loadedAt: null }, decision: { kind: 'reload', delayMs: retryDelayMs(count - 1) } };
}
