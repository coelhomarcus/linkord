import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { reactEasyCropStyleSource } from '../../scripts/cspStyleSources';

describe('reactEasyCropStyleSource', () => {
  it('reads the stylesheet the crop dialog injects at runtime', () => {
    const source = fs.readFileSync(path.resolve(import.meta.dirname, '../../node_modules/react-easy-crop/index.module.mjs'), 'utf8');
    const css = reactEasyCropStyleSource(source);
    expect(css?.startsWith('.reactEasyCrop_Container')).toBe(true);
    expect(css).toContain('.reactEasyCrop_CropAreaRound');
    expect(css).not.toContain('<');
  });

  it('returns null when the library no longer exposes that string', () => {
    expect(reactEasyCropStyleSource('var styles_default = 1;')).toBeNull();
    expect(reactEasyCropStyleSource('')).toBeNull();
  });
});
