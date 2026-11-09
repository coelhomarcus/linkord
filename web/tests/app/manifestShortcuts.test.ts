import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROUTES } from '@/shared/lib/routes';

const publicDir = resolve(__dirname, '../../public');
const manifest = JSON.parse(readFileSync(resolve(publicDir, 'manifest.webmanifest'), 'utf8')) as {
  shortcuts: { name: string; url: string; icons: { src: string; sizes: string; type: string }[] }[];
};

describe('manifest shortcuts', () => {
  it('open pages the router has a route for', () => {
    expect(manifest.shortcuts.map((shortcut) => shortcut.url)).toEqual([ROUTES.home, ROUTES.friends, ROUTES.notifications]);
  });

  it('each have their own 96x96 icon that exists', () => {
    const sources = manifest.shortcuts.map((shortcut) => shortcut.icons[0]?.src);
    expect(new Set(sources).size).toBe(manifest.shortcuts.length);
    for (const shortcut of manifest.shortcuts) {
      const [icon] = shortcut.icons;
      expect(icon).toMatchObject({ sizes: '96x96', type: 'image/png' });
      expect(existsSync(resolve(publicDir, `.${icon.src}`))).toBe(true);
    }
  });
});
