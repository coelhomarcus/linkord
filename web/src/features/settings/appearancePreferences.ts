import { useSyncExternalStore } from 'react';
import { LOCAL_STORAGE_KEYS, localStorageStore } from '@/shared/lib/localStorage';
import { getPreference, setPreference, subscribePreferences } from '@/shared/preferences/accountPreferences';
import { withoutTransitions } from './applyColorTheme';

// Density and font follow the account, like the color theme; text size stays on
// this device, since how large text should be depends on its screen. The inline
// boot script in index.html applies the same values before this bundle loads,
// so keep its lists in step with these.
export const DENSITIES = ['compact', 'default', 'comfortable'] as const;
export type Density = (typeof DENSITIES)[number];

export const TEXT_SIZES = ['small', 'default', 'large', 'larger'] as const;
export type TextSize = (typeof TEXT_SIZES)[number];

/** What each size multiplies the type scale (`--text-*`) by; styles/index.css has the same factors. */
export const TEXT_SCALE: Record<TextSize, number> = { small: 0.875, default: 1, large: 1.125, larger: 1.25 };

export const FONTS = ['figtree', 'system'] as const;
export type Font = (typeof FONTS)[number];

export interface Appearance {
  density: Density;
  textSize: TextSize;
  font: Font;
}

const DEFAULTS: Appearance = { density: 'default', textSize: 'default', font: 'figtree' };

function pick<T extends string>(raw: unknown, values: readonly T[], fallback: T): T {
  return values.find((value) => value === raw) ?? fallback;
}

// useSyncExternalStore needs the same object while nothing changed.
let snapshot: Appearance = DEFAULTS;

export function getAppearance(): Appearance {
  const next: Appearance = {
    density: pick(getPreference('density'), DENSITIES, DEFAULTS.density),
    textSize: pick(localStorageStore.get(LOCAL_STORAGE_KEYS.textSize), TEXT_SIZES, DEFAULTS.textSize),
    font: pick(getPreference('font'), FONTS, DEFAULTS.font),
  };
  if (next.density !== snapshot.density || next.textSize !== snapshot.textSize || next.font !== snapshot.font) snapshot = next;
  return snapshot;
}

/** Changes whenever the size of what a row lays out may have changed. */
export function appearanceLayoutKey(appearance: Appearance = getAppearance()): string {
  return `${appearance.density}:${appearance.textSize}:${appearance.font}`;
}

function setAttribute(root: HTMLElement, name: keyof Appearance, value: string): void {
  if (value === DEFAULTS[name]) delete root.dataset[name];
  else root.dataset[name] = value;
}

/** Puts the stored appearance on `<html>`, where styles/index.css reads it. */
export function applyAppearance(appearance: Appearance = getAppearance()): void {
  const root = document.documentElement;
  setAttribute(root, 'density', appearance.density);
  setAttribute(root, 'textSize', appearance.textSize);
  setAttribute(root, 'font', appearance.font);
}

// text size, the one kept on this device
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  const unsubscribe = subscribePreferences(listener);
  return () => { listeners.delete(listener); unsubscribe(); };
}

export function setDensity(value: Density): void {
  setPreference('density', value === DEFAULTS.density ? null : value);
}

export function setTextSize(value: TextSize): void {
  if (value === DEFAULTS.textSize) localStorageStore.remove(LOCAL_STORAGE_KEYS.textSize);
  else localStorageStore.set(LOCAL_STORAGE_KEYS.textSize, value);
  for (const listener of listeners) listener();
}

export function setFont(value: Font): void {
  setPreference('font', value === DEFAULTS.font ? null : value);
}

/** Puts the appearance on the page now and again whenever it changes, here or on another device. Rows
 * grow or shrink at once instead of each easing to its new size. */
export function followAppearance(): () => void {
  let shown = getAppearance();
  applyAppearance(shown);
  return subscribe(() => {
    const next = getAppearance();
    if (next === shown) return;
    shown = next;
    withoutTransitions(() => applyAppearance(next));
  });
}

export function useAppearance(): Appearance {
  return useSyncExternalStore(subscribe, getAppearance);
}
