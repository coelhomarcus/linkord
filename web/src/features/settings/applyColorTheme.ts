import type { ColorThemeId } from './useColorThemePreference';

// Keep in step with the inline map in index.html, which paints the same
// colors before this bundle loads.
const SHELL_BACKGROUND: Record<ColorThemeId, string> = {
  linkord: '#0d0d0f',
  light: '#edeef1',
  discord: '#202225',
  black: '#000000',
};

export function applyColorTheme(id: ColorThemeId): void {
  document.documentElement.dataset.theme = id;
  // the code-highlight palette switches on this class; every theme but Claro is dark
  document.documentElement.classList.toggle('dark', id !== 'light');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', SHELL_BACKGROUND[id]);
}
