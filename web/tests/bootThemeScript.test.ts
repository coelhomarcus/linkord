/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { COLOR_THEME_IDS, LEGACY_COLOR_THEME_IDS } from '@/features/settings/useColorThemePreference';
import { LOCAL_STORAGE_KEYS } from '@/shared/lib/localStorage';

const KEY = LOCAL_STORAGE_KEYS.colorTheme;

// The inline script in index.html that sets data-theme before React loads.
const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
const bootScript = (() => {
  const script = scripts.find((body) => body.includes(KEY));
  if (!script) throw new Error('theme boot script not found in index.html');
  return script;
})();

function boot(): void {
  new Function(bootScript)();
}

describe('theme boot script in index.html', () => {
  afterEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
    delete document.documentElement.dataset.density;
    document.head.querySelectorAll('style').forEach((style) => style.remove());
  });

  it('applies a stored current id as is', () => {
    localStorage.setItem(KEY, 'graphite');
    boot();
    expect(document.documentElement.dataset.theme).toBe('graphite');
  });

  it('copies old browser preferences before painting the theme', () => {
    localStorage.setItem('linkord.colorTheme', 'linkord');
    localStorage.setItem('linkord.density', 'compact');
    localStorage.setItem(LOCAL_STORAGE_KEYS.density, 'comfortable');
    for (const script of scripts) new Function(script)();
    expect(document.documentElement.dataset.theme).toBe('old');
    expect(document.documentElement.dataset.density).toBe('comfortable');
    expect(localStorage.getItem(KEY)).toBe('old');
    expect(localStorage.getItem('linkord.colorTheme')).toBeNull();
  });

  it('maps the ids stored before the rename and writes the new one back', () => {
    for (const [legacy, current] of Object.entries(LEGACY_COLOR_THEME_IDS)) {
      localStorage.setItem(KEY, legacy);
      boot();
      expect(document.documentElement.dataset.theme, legacy).toBe(current);
      expect(localStorage.getItem(KEY), legacy).toBe(current);
    }
  });

  it('paints the shell background of the migrated theme', () => {
    localStorage.setItem(KEY, 'discord');
    boot();
    expect(document.head.querySelector('style')?.textContent).toContain('#202225');
  });

  it('falls back to black for an unknown or unset value', () => {
    boot();
    expect(document.documentElement.dataset.theme).toBe('black');
    localStorage.setItem(KEY, 'constructor');
    boot();
    expect(document.documentElement.dataset.theme).toBe('black');
  });

  it('knows exactly the themes the app lists', () => {
    for (const id of COLOR_THEME_IDS) {
      localStorage.setItem(KEY, id);
      boot();
      expect(document.documentElement.dataset.theme).toBe(id);
    }
  });
});
