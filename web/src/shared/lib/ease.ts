export const EASE_OUT = [0.16, 1, 0.3, 1] as const;
export const EASE_DRAWER = [0.32, 0.72, 0, 1] as const;





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
