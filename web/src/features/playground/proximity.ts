// How loud someone sounds in a playground by how far away they stand: full
// volume within arm's reach of a conversation, fading on a curve (loudness is
// heard roughly logarithmically, so a straight line would sound like it drops
// off a cliff at the end) and silent past HEARING.silent.

export const HEARING = {
  /** metres within which a voice is at full volume */
  full: 3,
  /** metres from which a voice is no longer heard */
  silent: 24,
} as const;

export function proximityGain(distance: number): number {
  if (!Number.isFinite(distance) || distance <= HEARING.full) return 1;
  if (distance >= HEARING.silent) return 0;
  const t = (distance - HEARING.full) / (HEARING.silent - HEARING.full);
  return (1 - t) ** 2;
}
