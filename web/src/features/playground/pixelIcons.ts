// The playground's own icons, drawn on a 16×16 pixel grid like everything else
// in the game's interface, so the menu's dock and the HUD's corner do not mix
// smooth vector icons into the pixel art. Each row is a line of the grid: '#'
// takes the text's colour, 's' is a screen's glass. `off` crosses the icon out
// with a red bar, as the call's own muted icons are. Drawn as SVG by PixelIcon
// and onto a canvas by the nameplates over the avatars.

export const PIXEL_ICON_GRID = 16;

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

export interface PixelRun { x: number; y: number; width: number; fill: string }

/** One rect per run of same-coloured pixels on a row. */
function runs(rows: readonly string[], colors: Record<string, string>): PixelRun[] {
  const found: PixelRun[] = [];
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
const SLASH: readonly string[] = Array.from({ length: PIXEL_ICON_GRID }, (_, y) => Array.from({ length: PIXEL_ICON_GRID }, (_, x) => {
  const d = x + y;
  return d === 15 || d === 16 ? 'r' : d === 14 || d === 17 ? 'k' : '.';
}).join(''));

const SLASH_RUNS = runs(SLASH.map((row, y) => (y === 0 || y === 15 ? '.'.repeat(PIXEL_ICON_GRID) : row)), { r: '#e5484d', k: '#000' });

/** The rects that draw an icon, in grid units: its own pixels, then the slash when it is off. */
export function pixelIconRuns(name: PixelIconName, { color, glass, off = false }: { color: string; glass: string; off?: boolean }): PixelRun[] {
  const own = runs(ICONS[name], { '#': color, s: glass });
  return off ? [...own, ...SLASH_RUNS] : own;
}

/** Draws an icon on a canvas with its top left at (x, y), each grid pixel `scale` canvas pixels wide. */
export function drawPixelIcon(
  ctx: CanvasRenderingContext2D, name: PixelIconName, x: number, y: number, scale: number,
  options: { color: string; glass: string; off?: boolean },
): void {
  for (const run of pixelIconRuns(name, options)) {
    ctx.fillStyle = run.fill;
    ctx.fillRect(x + run.x * scale, y + run.y * scale, run.width * scale, scale);
  }
}
