// The dock shows any number; a larger one is no more useful than this
const MAX_BADGE = 9999;

/** The unread count the page asked for, or null when it is not a count. */
export function parseBadgeCount(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return null;
  return Math.min(value, MAX_BADGE);
}
