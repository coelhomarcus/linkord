const KEY = 'linkord.colorTheme';

export const COLOR_THEME_IDS = ['linkord', 'whatsapp', 'discord'] as const;
export type ColorThemeId = (typeof COLOR_THEME_IDS)[number];

export const COLOR_THEME_LABELS: Record<ColorThemeId, string> = {
  linkord: 'Padrão',
  whatsapp: 'Meia-noite',
  discord: 'Grafite',
};

function isColorThemeId(value: string | null): value is ColorThemeId {
  return value === 'linkord' || value === 'whatsapp' || value === 'discord';
}

export function loadColorTheme(): ColorThemeId {
  const raw = localStorage.getItem(KEY);
  return isColorThemeId(raw) ? raw : 'linkord';
}

export function saveColorTheme(value: ColorThemeId): void {
  localStorage.setItem(KEY, value);
}
