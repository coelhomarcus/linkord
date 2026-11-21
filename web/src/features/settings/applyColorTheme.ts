import type { ColorThemeId } from './useColorThemePreference';

// Keep in step with the inline map in index.html, which paints the same
// colors before this bundle loads.
const SHELL_BACKGROUND: Record<ColorThemeId, string> = {
  black: '#000000',
  old: '#0d0d0f',
  graphite: '#202225',
  latte: '#dce0e8',
  frappe: '#232634',
  macchiato: '#181926',
  mocha: '#11111b',
};

const SWITCHING_CLASS = 'theme-switching';

/** Runs a change to the whole page's look with every transition off for the
 * frame it lands in, so nothing eases from the old look to the new one. */
export function withoutTransitions(change: () => void): void {
  const root = document.documentElement;
  root.classList.add(SWITCHING_CLASS);
  change();
  // A layout read restyles the whole page now, while transitions are off;
  // dropping the class before that would let every element animate from the
  // old look.
  void document.body.offsetHeight;
  requestAnimationFrame(() => root.classList.remove(SWITCHING_CLASS));
}

export function applyColorTheme(id: ColorThemeId): void {
  const root = document.documentElement;
  const changing = root.dataset.theme !== undefined && root.dataset.theme !== id;
  const apply = () => {
    root.dataset.theme = id;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', SHELL_BACKGROUND[id]);
  };
  if (changing) withoutTransitions(apply);
  else apply();
}
