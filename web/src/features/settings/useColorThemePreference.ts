import { getPreference, setPreference, subscribePreferences } from '@/shared/preferences/accountPreferences';
import { applyColorTheme } from './applyColorTheme';

// The ids are what is stored for the account, so they outlive the labels. A
// stored id that is no longer listed (a removed theme) falls back to the
// default, Black.
export const COLOR_THEME_IDS = ['black', 'old', 'graphite', 'latte', 'frappe', 'macchiato', 'mocha'] as const;
export type ColorThemeId = (typeof COLOR_THEME_IDS)[number];

const DEFAULT_COLOR_THEME: ColorThemeId = 'black';

export const COLOR_THEME_LABELS: Record<ColorThemeId, string> = {
  black: 'Black',
  old: 'Old',
  graphite: 'Graphite',
  latte: 'Catppuccin Latte',
  frappe: 'Catppuccin Frappé',
  macchiato: 'Catppuccin Macchiato',
  mocha: 'Catppuccin Mocha',
};

// Ids written before the themes were renamed after their labels. The inline
// boot script in index.html migrates them too, so keep both maps in step.
// Only a browser's own old value can hold one: the account never stored them.
export const LEGACY_COLOR_THEME_IDS: Record<string, ColorThemeId> = {
  linkord: 'old',
  discord: 'graphite',
};

function isColorThemeId(value: string): value is ColorThemeId {
  return COLOR_THEME_IDS.some((id) => id === value);
}

export function loadColorTheme(): ColorThemeId {
  const raw = getPreference('colorTheme');
  if (typeof raw !== 'string') return DEFAULT_COLOR_THEME;
  if (Object.hasOwn(LEGACY_COLOR_THEME_IDS, raw)) return LEGACY_COLOR_THEME_IDS[raw];
  return isColorThemeId(raw) ? raw : DEFAULT_COLOR_THEME;
}

export function saveColorTheme(value: ColorThemeId): void {
  setPreference('colorTheme', value === DEFAULT_COLOR_THEME ? null : value);
}

/** Puts the theme on the page now and again whenever it changes, here or on another device. */
export function followColorTheme(): () => void {
  let shown = loadColorTheme();
  applyColorTheme(shown);
  return subscribePreferences(() => {
    const next = loadColorTheme();
    if (next === shown) return;
    shown = next;
    applyColorTheme(next);
  });
}
