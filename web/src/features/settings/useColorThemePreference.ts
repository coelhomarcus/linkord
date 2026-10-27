const KEY = 'linkord.colorTheme';

// The ids are what is stored in the browser, so they outlive the labels:
// 'linkord' is the Old theme (once the default) and 'discord' is Graphite. A
// stored id that is no longer listed (a removed theme) falls back to the
// default, Black.
export const COLOR_THEME_IDS = ['black', 'linkord', 'discord'] as const;
export type ColorThemeId = (typeof COLOR_THEME_IDS)[number];

export const DEFAULT_COLOR_THEME: ColorThemeId = 'black';

export const COLOR_THEME_LABELS: Record<ColorThemeId, string> = {
  black: 'Black',
  linkord: 'Old',
  discord: 'Graphite',
};

function isColorThemeId(value: string | null): value is ColorThemeId {
  return COLOR_THEME_IDS.some((id) => id === value);
}

export function loadColorTheme(): ColorThemeId {
  const raw = localStorage.getItem(KEY);
  return isColorThemeId(raw) ? raw : DEFAULT_COLOR_THEME;
}

export function saveColorTheme(value: ColorThemeId): void {
  localStorage.setItem(KEY, value);
}
