import { useSyncExternalStore } from 'react';
import { LOCAL_STORAGE_KEYS, localStorageStore, type LocalStorageKey } from '@/shared/lib/localStorage';
import { withoutTransitions } from './applyColorTheme';

// Stored per device, like the color theme. The inline boot script in
// index.html applies the same values before this bundle loads, so keep its
// lists in step with these.
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

function read<T extends string>(key: LocalStorageKey, values: readonly T[], fallback: T): T {
  const raw = localStorageStore.get(key);
  return values.find((value) => value === raw) ?? fallback;
}

// useSyncExternalStore needs the same object while nothing changed.
let snapshot: Appearance = DEFAULTS;

export function getAppearance(): Appearance {
  const next: Appearance = {
    density: read(LOCAL_STORAGE_KEYS.density, DENSITIES, DEFAULTS.density),
    textSize: read(LOCAL_STORAGE_KEYS.textSize, TEXT_SIZES, DEFAULTS.textSize),
    font: read(LOCAL_STORAGE_KEYS.font, FONTS, DEFAULTS.font),
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

const listeners = new Set<() => void>();

function save<K extends keyof Appearance>(key: LocalStorageKey, name: K, value: Appearance[K]): void {
  if (value === DEFAULTS[name]) localStorageStore.remove(key);
  else localStorageStore.set(key, value);
  const appearance = getAppearance();
  // Rows grow or shrink at once instead of each easing to its new size.
  withoutTransitions(() => applyAppearance(appearance));
  for (const listener of listeners) listener();
}

export function setDensity(value: Density): void {
  save(LOCAL_STORAGE_KEYS.density, 'density', value);
}

export function setTextSize(value: TextSize): void {
  save(LOCAL_STORAGE_KEYS.textSize, 'textSize', value);
}

export function setFont(value: Font): void {
  save(LOCAL_STORAGE_KEYS.font, 'font', value);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useAppearance(): Appearance {
  return useSyncExternalStore(subscribe, getAppearance);
}
