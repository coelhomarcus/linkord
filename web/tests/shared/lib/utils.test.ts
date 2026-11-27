/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cn } from '@/shared/lib/utils';

describe('cn', () => {
  it('keeps a theme font size when a text colour follows', () => {
    expect(cn('text-label', 'text-primary-foreground')).toBe('text-label text-primary-foreground');
    expect(cn('text-caption text-red')).toBe('text-caption text-red');
  });

  it('still lets a later theme font size replace an earlier one', () => {
    expect(cn('text-label', 'text-caption')).toBe('text-caption');
    expect(cn('text-body', 'text-sm')).toBe('text-sm');
  });

  it('knows every --text-* step in the shared base stylesheet as a font size', () => {
    const css = readFileSync(join(process.cwd(), 'src/styles/base.css'), 'utf8');
    const steps = [...css.matchAll(/^\s*--text-([a-z]+):\s/gm)].map(([, step]) => step);
    expect(steps).toContain('heading');
    for (const step of steps) {
      expect(cn(`text-${step}`, 'text-text-strong')).toBe(`text-${step} text-text-strong`);
      expect(cn('text-micro', `text-${step}`)).toBe(`text-${step}`);
    }
  });
});
