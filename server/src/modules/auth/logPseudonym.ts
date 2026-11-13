import crypto from 'node:crypto';

// People type their password into the username box, so a failed login's raw name may be a secret. A
// keyed hash still lets the log show repeated attempts against one name (a spray, a stuck client)
// without the value itself. The key lives only in this process and is never logged, so the tags
// cannot be reversed offline by guessing; they stop matching across restarts, which is enough to
// follow one incident.
const KEY = crypto.randomBytes(32);

/** A short, stable-per-process tag for a typed username, compared case-insensitively. */
export function usernameTag(typed: string): string {
  return crypto.createHmac('sha256', KEY).update(typed.trim().toLowerCase()).digest('hex').slice(0, 12);
}
