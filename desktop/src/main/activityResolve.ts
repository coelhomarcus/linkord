import type { DetectedActivity } from './activityDetect.js';

// Which of the activities running right now is the one shared, and when it may change. Several known
// programs are often open at once (a game, Spotify, an editor), so the choice cannot be the catalog's
// order: it follows what the person picked, then what they are looking at.

export interface ActivityPreferences {
  /** the activity the person picked in settings: shown whenever it runs */
  preferred: string | null;
  /** keys the account never shows: never picked, so another one shows instead */
  hidden: readonly string[];
}

const KEY = /^[a-z0-9][a-z0-9:._-]{0,79}$/;
const HIDDEN_MAX = 200;

/** A key sent by the page (the same rule as the server's `isActivityKey`), or null for anything else. */
export function parseActivityKey(raw: unknown): string | null {
  return typeof raw === 'string' && KEY.test(raw) ? raw : null;
}

/** The hidden keys sent by the page: valid keys only, at most as many as the server keeps. */
export function parseActivityKeys(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map(parseActivityKey).filter((key): key is string => key !== null))].slice(0, HIDDEN_MAX);
}

/** How long a different pick must hold before it replaces the shown activity while that one still
 * runs: alt-tabbing between two programs does not flip the status every check. */
export const STABILITY_MS = 25_000;

function allowed(candidates: readonly DetectedActivity[], hidden: readonly string[]): DetectedActivity[] {
  return candidates.filter((candidate) => !hidden.includes(candidate.key));
}

/** Whether the foreground program could change the pick: two or more allowed and none picked by hand.
 * Asking the system which window is in front costs a process (PowerShell on Windows), so it is only
 * asked when the answer matters. */
export function needsForeground(candidates: readonly DetectedActivity[], prefs: ActivityPreferences): boolean {
  const open = allowed(candidates, prefs.hidden);
  return open.length > 1 && !open.some((candidate) => candidate.key === prefs.preferred);
}

/**
 * The best activity, in this order: the one picked by hand, the game in the foreground, a game
 * sending Rich Presence (it says itself that it is being played), the game Steam says is running,
 * any other game, the app in the foreground, any other app (catalog order).
 */
export function pickActivity(
  candidates: readonly DetectedActivity[],
  prefs: ActivityPreferences,
  foregroundKey: string | null,
): DetectedActivity | null {
  const open = allowed(candidates, prefs.hidden);
  return open.find((c) => c.key === prefs.preferred)
    ?? open.find((c) => c.kind === 'playing' && c.key === foregroundKey)
    ?? open.find((c) => c.kind === 'playing' && c.discordAppId !== undefined)
    ?? open.find((c) => c.steamAppId !== undefined)
    ?? open.find((c) => c.kind === 'playing')
    ?? open.find((c) => c.key === foregroundKey)
    ?? open[0]
    ?? null;
}

export interface Challenger {
  key: string;
  since: number;
}

/**
 * What to show, given what shows now and the new pick. A pick replaces the shown activity at once
 * when that one stopped running or was hidden, or when the pick is the one chosen by hand; otherwise
 * only after it stayed the pick for `STABILITY_MS` (the `challenger` carries that from one check to
 * the next).
 */
export function settleActivity(input: {
  shown: string | null;
  pick: DetectedActivity | null;
  candidates: readonly DetectedActivity[];
  prefs: ActivityPreferences;
  challenger: Challenger | null;
  now: number;
}): { show: DetectedActivity | null; challenger: Challenger | null } {
  const { shown, pick, prefs, now } = input;
  if (!pick || pick.key === shown) return { show: pick, challenger: null };
  const current = allowed(input.candidates, prefs.hidden).find((candidate) => candidate.key === shown);
  if (!current || pick.key === prefs.preferred) return { show: pick, challenger: null };
  const challenger = input.challenger?.key === pick.key ? input.challenger : { key: pick.key, since: now };
  if (now - challenger.since >= STABILITY_MS) return { show: pick, challenger: null };
  return { show: current, challenger };
}
