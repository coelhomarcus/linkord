import { AVATAR_COLOR_OPTIONS } from '@/shared/Avatar';
import { oklchToHex, parseHex } from '@/shared/lib/colorMath';

/** The presets as the stylesheet defines them (`--color-avatar-*` in styles/index.css; a test keeps the two
 * the same), so the picker can place its cursor on a preset and draw its tick in a readable colour. */
export const PRESET_OKLCH: Record<(typeof AVATAR_COLOR_OPTIONS)[number]['value'], [number, number, number]> = {
  blurple: [0.55, 0.15, 275], green: [0.55, 0.15, 150], red: [0.55, 0.15, 25], fuchsia: [0.55, 0.15, 345],
  orange: [0.55, 0.144, 50], purple: [0.55, 0.15, 310], teal: [0.55, 0.094, 190], blue: [0.55, 0.138, 245],
};
export const presetHex = (value: string) => {
  const oklch = PRESET_OKLCH[value as keyof typeof PRESET_OKLCH];
  return oklch ? oklchToHex(...oklch) : null;
};
/** A stored colour (a preset's name or `#rrggbb`) as hex. */
export function hexOf(value: string): string {
  return presetHex(value) ?? parseHex(value) ?? presetHex('blurple')!;
}

