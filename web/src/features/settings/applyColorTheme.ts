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

export function applyColorTheme(id: ColorThemeId): void {
  document.documentElement.dataset.theme = id;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', SHELL_BACKGROUND[id]);
}
