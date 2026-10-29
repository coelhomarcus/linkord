// Below this much of the layout viewport hidden, it's browser chrome (the URL
// bar collapsing), not an on-screen keyboard.
const KEYBOARD_MIN_PX = 120;

/** Sizes the app to the part of the screen the user can actually see.
 *
 * iOS Safari never shrinks the layout viewport (nor `dvh`) for the on-screen
 * keyboard: the keyboard is laid over the page and the visual viewport is
 * panned instead, so anything pinned to the bottom of a `100dvh` shell (the
 * message composer) ends up under the keyboard or scrolled out of view. Chrome
 * on Android does the same unless the viewport meta opts into
 * `interactive-widget=resizes-content`. The visual viewport is the one
 * measurement that is right everywhere, so the shell reads its height and
 * offset from `--app-height` / `--app-top`, and `data-keyboard` drops the
 * home-indicator inset while the keyboard covers it anyway. */
export function installVisualViewportTracking(): () => void {
  const viewport = window.visualViewport;
  if (!viewport) return () => {};
  const root = document.documentElement;
  let frame = 0;

  const apply = () => {
    frame = 0;
    // a pinch-zoom shrinks the visual viewport too, and the app must not
    // shrink with it: only an unzoomed viewport tells the keyboard apart
    if (Math.abs(viewport.scale - 1) > 0.01) return;
    root.style.setProperty('--app-height', `${Math.round(viewport.height)}px`);
    root.style.setProperty('--app-top', `${Math.round(viewport.offsetTop)}px`);
    const hidden = root.clientHeight - viewport.height;
    if (hidden > KEYBOARD_MIN_PX) root.dataset.keyboard = 'open';
    else delete root.dataset.keyboard;
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(apply); };

  apply();
  viewport.addEventListener('resize', schedule);
  viewport.addEventListener('scroll', schedule);
  return () => {
    cancelAnimationFrame(frame);
    viewport.removeEventListener('resize', schedule);
    viewport.removeEventListener('scroll', schedule);
    root.style.removeProperty('--app-height');
    root.style.removeProperty('--app-top');
    delete root.dataset.keyboard;
  };
}
