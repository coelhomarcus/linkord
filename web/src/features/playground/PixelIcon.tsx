import { cn } from '@/shared/lib/utils';

// The playground's own icons, drawn on a 16×16 pixel grid like everything else
// in the game's interface, so the menu's dock and the HUD's corner do not mix
// smooth vector icons into the pixel art. Each row is a line of the grid: '#'
// takes the text's colour, 's' is a screen's glass. `off` crosses the icon out
// with a red bar, as the call's own muted icons are.

const ICONS = {
  mic: [
    '................',
    '......####......',
    '.....#....#.....',
    '.....#.##.#.....',
    '.....#.##.#.....',
    '.....#.##.#.....',
    '.....#.##.#.....',
    '...#.#....#.#...',
    '...#..####..#...',
    '...##......##...',
    '....##....##....',
    '......####......',
    '.......##.......',
    '.......##.......',
    '.....######.....',
    '................',
  ],
  speaker: [
    '................',
    '................',
    '.......#........',
    '......##....#...',
    '.....###..#..#..',
    '.#######...#..#.',
    '.#######...#..#.',
    '.#######...#..#.',
    '.#######...#..#.',
    '.#######...#..#.',
    '.#######...#..#.',
    '.....###..#..#..',
    '......##....#...',
    '.......#........',
    '................',
    '................',
  ],
  screen: [
    '................',
    '................',
    '.##############.',
    '.#............#.',
    '.#.ssssssssss.#.',
    '.#.ssssssssss.#.',
    '.#.ssssssssss.#.',
    '.#.ssssssssss.#.',
    '.#.ssssssssss.#.',
    '.#............#.',
    '.##############.',
    '......####......',
    '.......##.......',
    '....########....',
    '................',
    '................',
  ],
} as const satisfies Record<string, readonly string[]>;

export type PixelIconName = keyof typeof ICONS;

interface Run { x: number; y: number; width: number; fill: string }

/** One rect per run of same-coloured pixels on a row. */
function runs(rows: readonly string[], colors: Record<string, string>): Run[] {
  const found: Run[] = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const fill = colors[row[x]!];
      if (!fill) {
        x++;
        continue;
      }
      let end = x + 1;
      while (end < row.length && row[end] === row[x]) end++;
      found.push({ x, y, width: end - x, fill });
      x = end;
    }
  });
  return found;
}

/** The red bar across an icon that is off: two pixels thick, bottom left to top right, edged in black. */
const SLASH: readonly string[] = Array.from({ length: 16 }, (_, y) => Array.from({ length: 16 }, (_, x) => {
  const d = x + y;
  return d === 15 || d === 16 ? 'r' : d === 14 || d === 17 ? 'k' : '.';
}).join(''));

const SLASH_RUNS = runs(SLASH.map((row, y) => (y === 0 || y === 15 ? '.'.repeat(16) : row)), { r: '#e5484d', k: '#000' });

export function PixelIcon({ name, off = false, glass = 'rgb(255 255 255 / 0.35)', className }: {
  name: PixelIconName; off?: boolean; glass?: string; className?: string;
}) {
  return (
    <svg aria-hidden viewBox="0 0 16 16" shapeRendering="crispEdges" className={cn('size-6 flex-none drop-shadow-[2px_2px_0_rgb(0_0_0/0.55)]', className)}>
      {runs(ICONS[name], { '#': 'currentColor', s: glass }).map((run) => <rect key={`${run.x},${run.y}`} x={run.x} y={run.y} width={run.width} height={1} fill={run.fill} />)}
      {off && SLASH_RUNS.map((run) => <rect key={`slash ${run.x},${run.y}`} x={run.x} y={run.y} width={run.width} height={1} fill={run.fill} />)}
    </svg>
  );
}
