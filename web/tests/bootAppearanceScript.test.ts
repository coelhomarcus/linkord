/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DENSITIES, FONTS, TEXT_SIZES } from '@/features/settings/appearancePreferences';
import { LOCAL_STORAGE_KEYS } from '@/shared/lib/localStorage';

// The inline script in index.html that sets density, text size and font before React loads.
const bootScript = (() => {
  const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((body) => body.includes(LOCAL_STORAGE_KEYS.density));
  if (!script) throw new Error('appearance boot script not found in index.html');
  return script;
})();

function boot(): void {
  new Function(bootScript)();
}

const root = document.documentElement;

describe('appearance boot script in index.html', () => {
  afterEach(() => {
    localStorage.clear();
    delete root.dataset.density;
    delete root.dataset.textSize;
    delete root.dataset.font;
  });

  it('applies every value the app lists, and leaves the defaults without an attribute', () => {
    const cases = [
      [LOCAL_STORAGE_KEYS.density, 'density', DENSITIES],
      [LOCAL_STORAGE_KEYS.textSize, 'textSize', TEXT_SIZES],
      [LOCAL_STORAGE_KEYS.font, 'font', FONTS],
    ] as const;
    for (const [key, name, values] of cases) {
      for (const value of values) {
        delete root.dataset[name];
        localStorage.setItem(key, value);
        boot();
        const isDefault = value === 'default' || value === 'figtree';
        expect(root.dataset[name], `${name}=${value}`).toBe(isDefault ? undefined : value);
      }
    }
  });

  it('ignores a value it does not know', () => {
    localStorage.setItem(LOCAL_STORAGE_KEYS.density, 'cozy');
    boot();
    expect(root.dataset.density).toBeUndefined();
  });
});
