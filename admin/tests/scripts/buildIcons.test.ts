import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { FLUENT_ICONS, ICON_MODULE, importedIconNames, renderIconModule } from '../../scripts/buildIcons';

it('has generated every imported admin icon (run `bun run --cwd admin icons`)', () => {
  const names = importedIconNames();
  expect(Object.keys(FLUENT_ICONS).sort()).toEqual(names);
  expect(readFileSync(ICON_MODULE, 'utf8')).toBe(renderIconModule(names));
});
