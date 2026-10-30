// how much the visible area must shrink below the window to be a keyboard,
// not a browser toolbar sliding in or out
const KEYBOARD_MIN_HEIGHT = 150;

const VARS = ['--app-viewport-top', '--app-viewport-height', '--safe-bottom'] as const;

/** Pins #root to the phone's visual viewport (see index.css). Off a phone
 * the variables are cleared and the CSS defaults apply. */
export function syncViewportVars(
  root: CSSStyleDeclaration,
  viewport: { offsetTop: number; height: number },
  windowHeight: number,
  phone: boolean,
): void {
  if (!phone) {
    clearViewportVars(root);
    return;
  }
  // offsetTop too: iOS pans the visual viewport to reveal a focused input,
  // and #root (fixed) has to follow that pan, not just shrink
  root.setProperty('--app-viewport-top', `${viewport.offsetTop}px`);
  root.setProperty('--app-viewport-height', `${viewport.height}px`);
  // the keyboard covers the home-indicator strip: the safe-area gap kept
  // under the composer would float it that far above the keys
  if (windowHeight - viewport.height > KEYBOARD_MIN_HEIGHT) root.setProperty('--safe-bottom', '0px');
  else root.removeProperty('--safe-bottom');
}

export function clearViewportVars(root: CSSStyleDeclaration): void {
  for (const name of VARS) root.removeProperty(name);
}
