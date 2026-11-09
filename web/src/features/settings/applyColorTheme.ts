import type { ColorThemeId } from './useColorThemePreference';

// Keep in step with the inline map in index.html, which paints the same
// colors before this bundle loads.
const SHELL_BACKGROUND: Record<ColorThemeId, string> = {
  black: '#000000',
  old: '#0d0d0f',
  graphite: '#202225',
};

export function applyColorTheme(id: ColorThemeId): void {
  document.documentElement.dataset.theme = id;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', SHELL_BACKGROUND[id]);
}
