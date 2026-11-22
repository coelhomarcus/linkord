// The unread count on the Windows taskbar button. Windows has no badge API
// (app.setBadgeCount does nothing there): the count is an overlay icon drawn
// here, pixel by pixel, so it needs no image files and no canvas.

/** The taskbar overlay is a small icon: 16 px at 100% scaling. */
const OVERLAY_SIZE = 16;
const MAX_SHOWN = 99;
// The app's red (--color-red in web/src/styles/index.css), as sRGB
const FILL = { r: 218, g: 55, b: 60 } as const;
const SUBSAMPLES = 4;

interface Font {
  width: number;
  height: number;
  glyphs: Record<string, readonly string[]>;
}

// Tried first: it reads best whenever it fits
const FONT_5X7: Font = {
  width: 5,
  height: 7,
  glyphs: {
    0: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
    1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
    2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
    3: ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
    4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
    5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
    6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
    7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
    8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
    9: ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
    '+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000'],
  },
};

// "99+" in 16 px only fits in this one
const FONT_3X5: Font = {
  width: 3,
  height: 5,
  glyphs: {
    0: ['111', '101', '101', '101', '111'],
    1: ['010', '110', '010', '010', '111'],
    2: ['111', '001', '111', '100', '111'],
    3: ['111', '001', '111', '001', '111'],
    4: ['101', '101', '111', '001', '001'],
    5: ['111', '100', '111', '001', '111'],
    6: ['111', '100', '111', '101', '111'],
    7: ['111', '001', '001', '001', '001'],
    8: ['111', '101', '111', '101', '111'],
    9: ['111', '101', '111', '001', '111'],
    '+': ['000', '010', '111', '010', '000'],
  },
};

/** The unread count the page asked for, or null when it is not a count. */
export function parseBadgeCount(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return null;
  return value;
}

/** What the badge reads, or null for no badge at all. */
export function badgeLabel(count: number): string | null {
  if (count <= 0) return null;
  return count > MAX_SHOWN ? `${MAX_SHOWN}+` : String(count);
}

/** The icon's side in pixels on a display with this scale factor (1.25 for 125%). */
export function badgeSize(scaleFactor: number): number {
  const scale = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
  return Math.min(OVERLAY_SIZE * 4, Math.max(OVERLAY_SIZE, Math.round(OVERLAY_SIZE * scale)));
}

interface TextLayout {
  font: Font;
  scale: number;
  width: number;
  height: number;
}

/** How the label fits inside the circle at the largest whole scale, or null when it cannot. */
export function layoutText(label: string, size: number): TextLayout | null {
  const fine = fit(FONT_5X7, label, size);
  const coarse = fit(FONT_3X5, label, size);
  // The blocky font only wins where the finer one would come out tiny and it clearly
  // larger: "99+" on a large icon
  if (fine && (fine.height >= size / 4 || !coarse || coarse.height < fine.height * 1.4)) return fine;
  return coarse;
}

function fit(font: Font, label: string, size: number): TextLayout | null {
  const unitWidth = label.length * font.width + (label.length - 1);
  const scale = Math.min(Math.floor((size * 0.75) / unitWidth), Math.floor((size * 0.6) / font.height));
  return scale >= 1 ? { font, scale, width: unitWidth * scale, height: font.height * scale } : null;
}

export interface BadgeBitmap {
  size: number;
  /** BGRA with premultiplied alpha, row by row: what nativeImage.createFromBitmap reads */
  data: Buffer;
}

/** A red disc with the label in white, its edge smoothed; the text is left out when it cannot fit. */
export function drawBadge(label: string, size: number): BadgeBitmap {
  const data = Buffer.alloc(size * size * 4);
  const radius = size / 2;
  const text = textMask(label, size);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let inside = 0;
      for (let sy = 0; sy < SUBSAMPLES; sy += 1) {
        for (let sx = 0; sx < SUBSAMPLES; sx += 1) {
          const dx = x + (sx + 0.5) / SUBSAMPLES - radius;
          const dy = y + (sy + 0.5) / SUBSAMPLES - radius;
          if (dx * dx + dy * dy <= radius * radius) inside += 1;
        }
      }
      const alpha = inside / (SUBSAMPLES * SUBSAMPLES);
      if (alpha === 0) continue;
      const white = text[y * size + x] === 1;
      const offset = (y * size + x) * 4;
      data[offset] = Math.round((white ? 255 : FILL.b) * alpha);
      data[offset + 1] = Math.round((white ? 255 : FILL.g) * alpha);
      data[offset + 2] = Math.round((white ? 255 : FILL.r) * alpha);
      data[offset + 3] = Math.round(255 * alpha);
    }
  }
  return { size, data };
}

function textMask(label: string, size: number): Uint8Array {
  const mask = new Uint8Array(size * size);
  const layout = layoutText(label, size);
  if (!layout) return mask;
  const { font, scale } = layout;
  const left = Math.round((size - layout.width) / 2);
  const top = Math.round((size - layout.height) / 2);
  [...label].forEach((char, index) => {
    const rows = font.glyphs[char];
    if (!rows) return;
    const glyphLeft = left + index * (font.width + 1) * scale;
    rows.forEach((row, rowIndex) => {
      [...row].forEach((bit, column) => {
        if (bit !== '1') return;
        for (let py = 0; py < scale; py += 1) {
          for (let px = 0; px < scale; px += 1) {
            mask[(top + rowIndex * scale + py) * size + glyphLeft + column * scale + px] = 1;
          }
        }
      });
    });
  });
  return mask;
}
