// How loud someone sounds in a playground by how far away they stand: full
// volume around a conversation, fading gently on a curve (loudness is heard
// roughly logarithmically, so a straight line would sound like it drops off a
// cliff at the end) and silent only past HEARING.silent, about the island's
// width: anyone in sight can still be heard, just softer the further they are.

export const HEARING = {
  /** metres within which a voice is at full volume */
  full: 8,
  /** metres from which a voice is no longer heard */
  silent: 72,
} as const;

/** how sharply the fade bends: 1 is a straight line, 2 drops fast at first */
const FALLOFF = 1.5;

export function proximityGain(distance: number): number {
  if (!Number.isFinite(distance) || distance <= HEARING.full) return 1;
  if (distance >= HEARING.silent) return 0;
  const t = (distance - HEARING.full) / (HEARING.silent - HEARING.full);
  return (1 - t) ** FALLOFF;
}
