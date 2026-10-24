import type { ColorThemeId } from './useColorThemePreference';

const SHELL_BACKGROUND: Record<ColorThemeId, string> = {
  linkord: '#0d0d0f',
  whatsapp: '#111b21',
  discord: '#202225',
};

export function applyColorTheme(id: ColorThemeId): void {
  document.documentElement.dataset.theme = id;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', SHELL_BACKGROUND[id]);
}
