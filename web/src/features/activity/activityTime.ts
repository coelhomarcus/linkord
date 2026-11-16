/** How long an activity has run, as a stopwatch reads: "0:42", "41:28", "1:19:35". */
export function formatActivityTimer(elapsedMs: number): string {
  const total = Math.max(0, Math.floor(elapsedMs / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const ss = String(seconds).padStart(2, '0');
  if (!hours) return `${minutes}:${ss}`;
  return `${hours}:${String(minutes).padStart(2, '0')}:${ss}`;
}

export type PlayedAgoUnit = 'now' | 'minutes' | 'hours' | 'days' | 'weeks' | 'months' | 'years';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/** How long ago something was last played, in the largest whole unit: "1h", "2d", "2 sem.". The
 * words come from the `activity:ago.*` keys, so the unit and its count are all this decides. */
export function playedAgo(elapsedMs: number): { unit: PlayedAgoUnit; count: number } {
  const ms = Math.max(0, elapsedMs);
  if (ms < MINUTE) return { unit: 'now', count: 0 };
  if (ms < HOUR) return { unit: 'minutes', count: Math.floor(ms / MINUTE) };
  if (ms < DAY) return { unit: 'hours', count: Math.floor(ms / HOUR) };
  if (ms < WEEK) return { unit: 'days', count: Math.floor(ms / DAY) };
  if (ms < MONTH) return { unit: 'weeks', count: Math.floor(ms / WEEK) };
  if (ms < YEAR) return { unit: 'months', count: Math.floor(ms / MONTH) };
  return { unit: 'years', count: Math.floor(ms / YEAR) };
}
