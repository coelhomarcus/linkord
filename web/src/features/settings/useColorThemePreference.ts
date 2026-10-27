const KEY = 'linkord.colorTheme';

// 'discord' predates the label "Grafite" and stays as the stored id, so a
// saved preference keeps working. A stored id that is no longer listed (a
// removed theme) falls back to the default.
export const COLOR_THEME_IDS = ['linkord', 'black', 'discord'] as const;
export type ColorThemeId = (typeof COLOR_THEME_IDS)[number];

export const COLOR_THEME_LABELS: Record<ColorThemeId, string> = {
  linkord: 'Padrão',
  black: 'Preto',
  discord: 'Grafite',
};

function isColorThemeId(value: string | null): value is ColorThemeId {
  return COLOR_THEME_IDS.some((id) => id === value);
}

export function loadColorTheme(): ColorThemeId {
  const raw = localStorage.getItem(KEY);
  return isColorThemeId(raw) ? raw : 'linkord';
}

export function saveColorTheme(value: ColorThemeId): void {
  localStorage.setItem(KEY, value);
}
