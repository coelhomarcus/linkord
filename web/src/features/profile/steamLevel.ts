// Steam rings a level in one colour per ten (Steam's own `lvl_N` classes). From 100 it draws
// hexagons, shields and other shapes; we keep the ring and cycle the colours again.
const RING_COLORS = ['#9b9b9b', '#c02942', '#d95b43', '#fecc23', '#467a3c', '#4e8ddb', '#7652c9', '#c252c9', '#542437', '#997c52'] as const;

export function steamLevelColor(level: number): string {
  return RING_COLORS[Math.floor(Math.max(0, level) / 10) % RING_COLORS.length]!;
}
