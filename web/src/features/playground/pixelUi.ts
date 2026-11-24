import { PIXEL_TEXT } from './pixelFont';

// The playground's own look for its menu and HUD: chunky blocks with a lit top
// edge and a shaded bottom one, square corners and the pixel font with a hard
// shadow, so the interface reads as part of the block world rather than the
// app laid over it.

/** a hard one-pixel-grid shadow under the pixel font, legible over any sky */
export const PIXEL_SHADOW = '[text-shadow:2px_2px_0_rgb(0_0_0/0.55)]';

const BEVEL = 'shadow-[inset_2px_2px_0_rgb(255_255_255/0.22),inset_-2px_-3px_0_rgb(0_0_0/0.45)]';
const PRESSED = 'active:shadow-[inset_2px_2px_0_rgb(0_0_0/0.45),inset_-2px_-2px_0_rgb(255_255_255/0.12)] active:translate-y-px';

/** A menu button: a raised slab, brighter and outlined white when hovered or focused. */
export const PIXEL_BUTTON = [
  'relative flex min-h-11 items-center justify-center gap-2 border-2 border-black/80 bg-[#5b5f69] px-3 text-center text-white outline-none',
  BEVEL, PRESSED, PIXEL_SHADOW, PIXEL_TEXT.lg, 'leading-none',
  'transition-colors duration-100 hover:bg-[#6f7480] focus-visible:border-white hover:border-white/90',
  'aria-disabled:cursor-not-allowed aria-disabled:bg-[#3c3f46] aria-disabled:text-white/45 aria-disabled:hover:border-black/80',
].join(' ');

/** The button that leaves the call: the same slab, tinted. */
export const PIXEL_BUTTON_DANGER = 'bg-[#8a3232] hover:bg-[#a33b3b]';

/** The menu's frame and the HUD's small panels: a dark sunken block. */
export const PIXEL_PANEL = 'border-2 border-black/80 bg-[#1d1f24]/90 shadow-[inset_2px_2px_0_rgb(255_255_255/0.08),inset_-2px_-2px_0_rgb(0_0_0/0.5)]';

/** A HUD button over the world: a smaller slab, see-through. */
export const HUD_BUTTON = [
  'pointer-events-auto flex min-h-9 items-center gap-2 whitespace-nowrap border-2 border-black/70 bg-[#2a2c32]/80 px-2.5 text-white outline-none',
  BEVEL, PRESSED, PIXEL_SHADOW, PIXEL_TEXT.md, 'leading-none',
  'hover:bg-[#3a3d45]/90 hover:border-white/80 focus-visible:border-white',
].join(' ');

/** A HUD status line (muted, deafened, sharing). */
export const HUD_CHIP = `flex items-center gap-1.5 border-2 border-black/60 bg-[#1d1f24]/75 px-2 py-0.5 ${PIXEL_TEXT.sm} leading-none text-white ${PIXEL_SHADOW}`;
