/** Hue in degrees (0–360), saturation and value from 0 to 1: the model a picker's square and bar draw. */
export interface Hsv { h: number; s: number; v: number }

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** `#rrggbb`, from `#rgb` or `#rrggbb` with or without the `#`; null for anything else. */
export function parseHex(value: string): string | null {
  const match = HEX.exec(value.trim());
  if (!match) return null;
  const digits = match[1]!.length === 3 ? match[1]!.split('').map((c) => c + c).join('') : match[1]!;
  return `#${digits.toLowerCase()}`;
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((channel) => Math.round(clamp(channel) * 255).toString(16).padStart(2, '0')).join('')}`;
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return rgbToHex(f(5), f(3), f(1));
}

export function hexToHsv(hex: string): Hsv {
  const parsed = parseHex(hex) ?? '#000000';
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(parsed.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  let h = 0;
  if (delta) {
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
  }
  return { h: (h + 360) % 360, s: max ? delta / max : 0, v: max };
}

/** The sRGB colour of an OKLCH one (lightness 0–1), clipped into the sRGB gamut. The avatar presets are
 * defined in OKLCH in the stylesheet; the picker needs them as RGB to place its cursor on them. */
export function oklchToHex(l: number, c: number, hue: number): string {
  const a = c * Math.cos((hue * Math.PI) / 180);
  const b = c * Math.sin((hue * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
  const [r, g, bl] = linear.map((x) => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.max(x, 0) ** (1 / 2.4) - 0.055)) as [number, number, number];
  return rgbToHex(r, g, bl);
}

/** Black or white, whichever reads better on `hex`: for the tick drawn over a swatch. */
export function contrastOn(hex: string): '#000000' | '#ffffff' {
  const { s, v, h } = hexToHsv(hex);
  // yellows and greens look light at a lower value than blues do
  const light = v > 0.75 && (s < 0.5 || (h > 40 && h < 200));
  return light ? '#000000' : '#ffffff';
}
