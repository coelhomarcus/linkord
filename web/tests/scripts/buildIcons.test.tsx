import fs from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ComponentType } from 'react';
import { describe, expect, it } from 'vitest';
import * as icons from '@/shared/ui/icons/phosphor';
import { ICON_MODULE, WEIGHTS, importedIconNames, renderIconModule } from '../../scripts/buildIcons';

async function packageIcon(name: string): Promise<ComponentType<Record<string, unknown>>> {
  const module = await import(`@phosphor-icons/react/dist/csr/${name.replace(/Icon$/, '')}`);
  return module[name];
}

describe('buildIcons', () => {
  it('has generated every imported icon and nothing else (run `npm run icons`)', async () => {
    expect(fs.readFileSync(ICON_MODULE, 'utf8')).toBe(await renderIconModule(importedIconNames()));
  });

  it('draws each icon exactly as @phosphor-icons/react does', async () => {
    expect(Object.keys(icons).sort()).toEqual(importedIconNames());
    for (const [name, Icon] of Object.entries(icons)) {
      const Original = await packageIcon(name);
      expect(renderToStaticMarkup(<Icon />), name).toBe(renderToStaticMarkup(<Original />));
      for (const weight of WEIGHTS) {
        const props = { size: 20, weight, 'aria-hidden': true, className: 'text-text-muted' } as const;
        expect(renderToStaticMarkup(<Icon {...props} />), `${name} ${weight}`).toBe(renderToStaticMarkup(<Original {...props} />));
      }
    }
  });

  it('keeps the color, mirrored and alt props', async () => {
    const Original = await packageIcon('BellIcon');
    const props = { color: 'red', mirrored: true, alt: 'Bell', size: '2em' };
    expect(renderToStaticMarkup(<icons.BellIcon {...props} />)).toBe(renderToStaticMarkup(<Original {...props} />));
  });

  it('refuses a weight that was left out', () => {
    // @ts-expect-error thin, light and duotone are not generated
    expect(() => renderToStaticMarkup(<icons.BellIcon weight="duotone" />)).toThrow();
  });
});
