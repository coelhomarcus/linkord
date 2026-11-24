// Experience as the block game counts it: 7 points to level 1, then 2 more for
// each level, 5 more from level 15 and 9 more from level 30. The playground service gives the
// points (playground/src/combat.ts at the repo root, which mirrors this curve to
// reward a kill); this turns them into the level and how full the bar is.

function pointsToNextLevel(level: number): number {
  if (level >= 30) return 112 + (level - 30) * 9;
  if (level >= 15) return 37 + (level - 15) * 5;
  return 7 + level * 2;
}

/** The level `points` reach, and how far into the next one (0..1). */
export function experienceLevel(points: number): { level: number; progress: number } {
  let level = 0;
  let left = Math.max(0, Math.floor(points));
  while (left >= pointsToNextLevel(level)) {
    left -= pointsToNextLevel(level);
    level++;
  }
  return { level, progress: left / pointsToNextLevel(level) };
}
