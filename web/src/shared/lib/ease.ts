/** The curve for anything appearing or moving into place; `ease-out-expo` in CSS (styles/index.css). */
export const EASE_OUT = [0.16, 1, 0.3, 1] as const;
export const EASE_DRAWER = [0.32, 0.72, 0, 1] as const;

/** EASE_OUT as a CSS timing function, for libraries that take a string (dnd-kit's transitions). */
export const EASE_OUT_CSS = `cubic-bezier(${EASE_OUT.join(', ')})`;

/** The standard durations, in milliseconds; the same steps as the CSS utilities motion-popup and
 * motion-modal. Anything that animates picks one of these rather than a number of its own:
 * - `exit`: a popover, menu or tooltip leaving, and hover/focus feedback (100)
 * - `enter`: a popover, menu or tooltip appearing; a modal or a save bar leaving (150)
 * - `settle`: a modal or a save bar appearing, and things moving into place, like the Wall's widgets (200)
 * Motion takes seconds: divide by 1000. Drawers and sheets (EASE_DRAWER) travel further and keep their own. */
export const DURATION = { exit: 100, enter: 150, settle: 200 } as const;

/** Shared-layout glides — pills, indicators and panels morphing between positions. */
export const SPRING_LAYOUT = {
  type: "spring",
  stiffness: 360,
  damping: 32,
  mass: 0.6,
} as const;

/** A sidebar opening or closing beside the content. Critically damped: the
 * panel settles against a hard edge (zero width), so any overshoot would pause
 * against it and then snap back during the final frame. */
export const SPRING_SIDEBAR = {
  type: "spring",
  stiffness: 380,
  damping: 35,
  mass: 0.75,
} as const;
