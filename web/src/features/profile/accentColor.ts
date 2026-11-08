import { hexToOklch, parseHex, withMinLightness } from './colorMath';

// Every theme is dark: below this OKLCH lightness an accent stops standing out from the surfaces the Wall
// draws it on. The presets sit at 0.55 and read well; this leaves them alone.
export const MIN_ACCENT_LIGHTNESS = 0.55;

/** The profile colour as the Wall's widgets draw it. Any colour can be picked (a black avatar is a fine
 * choice), so a colour too dark to read on a dark surface is lightened here, where it is drawn, instead of
 * being refused when picked. A preset (a CSS variable) is already readable and passes through. */
export function readableAccent(color: string): string {
  return parseHex(color) ? withMinLightness(color, MIN_ACCENT_LIGHTNESS) : color;
}

/** Whether `color` gets lightened on the Wall: the picker says so while it is chosen. */
export function isTooDarkForAccent(color: string): boolean {
  const hex = parseHex(color);
  return !!hex && hexToOklch(hex).l < MIN_ACCENT_LIGHTNESS - 0.005;
}
