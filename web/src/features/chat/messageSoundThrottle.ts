// A conversation's burst lasts until it goes this long without a message, so
// a friend typing several lines in a row chimes once, not once per line.
export const BURST_QUIET_MS = 5_000;

// Sounds from different conversations still need spacing, or a busy group
// and a DM arriving together stack into a run of chimes.
export const GLOBAL_COOLDOWN_MS = 2_000;

interface Burst {
  lastMessageAt: number;
  chimed: boolean;
}

/** Decides, per incoming message, whether the "new message" sound plays. */
export function createMessageSoundThrottle() {
  const bursts = new Map<string, Burst>();
  let lastChimeAt = -Infinity;

  return function shouldChime(conversationId: string, mentioned: boolean, now = Date.now()): boolean {
    const previous = bursts.get(conversationId);
    const burst = previous && now - previous.lastMessageAt < BURST_QUIET_MS ? previous : { lastMessageAt: now, chimed: false };
    burst.lastMessageAt = now;
    bursts.set(conversationId, burst);
    // a mention deserves its own sound even mid-burst; only the global
    // spacing still applies to it
    if (burst.chimed && !mentioned) return false;
    // silenced only by another conversation's sound: the burst hasn't chimed
    // yet, so its next message still can
    if (now - lastChimeAt < GLOBAL_COOLDOWN_MS) return false;
    burst.chimed = true;
    lastChimeAt = now;
    return true;
  };
}
