import { LOCAL_STORAGE_KEYS, localStorageStore } from '@/shared/lib/localStorage';

// The ids are what is stored in the browser, so they outlive the labels. A
// stored id that is no longer listed (a removed theme) falls back to the
// default, Black.
export const COLOR_THEME_IDS = ['black', 'old', 'graphite'] as const;
export type ColorThemeId = (typeof COLOR_THEME_IDS)[number];

const DEFAULT_COLOR_THEME: ColorThemeId = 'black';

export const COLOR_THEME_LABELS: Record<ColorThemeId, string> = {
  black: 'Black',
  old: 'Old',
  graphite: 'Graphite',
};

// Ids written before the themes were renamed after their labels. The inline
// boot script in index.html migrates them too, so keep both maps in step.
export const LEGACY_COLOR_THEME_IDS: Record<string, ColorThemeId> = {
  linkord: 'old',
  discord: 'graphite',
};

function isColorThemeId(value: string | null): value is ColorThemeId {
  return COLOR_THEME_IDS.some((id) => id === value);
}

export function loadColorTheme(): ColorThemeId {
  const raw = localStorageStore.get(LOCAL_STORAGE_KEYS.colorTheme);
  if (raw !== null && Object.hasOwn(LEGACY_COLOR_THEME_IDS, raw)) {
    const migrated = LEGACY_COLOR_THEME_IDS[raw];
    saveColorTheme(migrated);
    return migrated;
  }
  return isColorThemeId(raw) ? raw : DEFAULT_COLOR_THEME;
}

export function saveColorTheme(value: ColorThemeId): void {
  localStorageStore.set(LOCAL_STORAGE_KEYS.colorTheme, value);
}
