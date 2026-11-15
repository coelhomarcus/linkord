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
