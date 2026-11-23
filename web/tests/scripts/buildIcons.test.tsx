import fs from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import * as icons from '@/shared/ui/icons/fluent';
import { WindowsLogoIcon } from '@/shared/ui/icons';
import { FLUENT_ICONS, ICON_MODULE, STYLES, fluentPaths, importedIconNames, renderIconModule } from '../../scripts/buildIcons';

function drawnPaths(markup: string): string[] {
  return [...markup.matchAll(/<path d="([^"]+)"/g)].map((match) => match[1]!);
}

describe('buildIcons', () => {
  it('has generated every imported icon and nothing else (run `npm run icons`)', () => {
    expect(fs.readFileSync(ICON_MODULE, 'utf8')).toBe(renderIconModule(importedIconNames()));
  });

  it('draws each icon from its Fluent file in both styles', () => {
    expect(Object.keys(icons).sort()).toEqual(importedIconNames());
    for (const [name, Icon] of Object.entries(icons)) {
      for (const [weight, style] of Object.entries(STYLES)) {
        const markup = renderToStaticMarkup(<Icon weight={weight as keyof typeof STYLES} />);
        expect(drawnPaths(markup), `${name} ${weight}`).toEqual(fluentPaths(name, style));
        expect(markup).toContain('viewBox="0 0 20 20"');
      }
    }
  });

  it('names a Fluent file only for icons the app imports', () => {
    expect(Object.keys(FLUENT_ICONS).sort()).toEqual(importedIconNames());
  });

  it('keeps the size, color, mirrored and alt props', () => {
    const markup = renderToStaticMarkup(<icons.BellIcon color="red" mirrored alt="Bell" size="2em" />);
    expect(markup).toMatch(/^<svg [^>]*width="2em" height="2em" fill="red" viewBox="0 0 20 20" transform="scale\(-1, 1\)"><title>Bell<\/title><path/);
  });

  it('refuses a weight Fluent does not draw', () => {
    // @ts-expect-error only regular and fill are generated
    expect(() => renderToStaticMarkup(<icons.BellIcon weight="bold" />)).toThrow();
  });

  it('draws the brand logos with the same props', () => {
    const markup = renderToStaticMarkup(<WindowsLogoIcon size={22} weight="fill" className="logo" alt="Windows" />);
    expect(markup).toMatch(/^<svg [^>]*class="logo"/);
    expect(markup).toContain('<title>Windows</title>');
    expect(markup).not.toContain('weight=');
  });
});
