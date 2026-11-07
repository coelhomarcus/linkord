import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function block(css: string, selector: string, next: string): string {
  const start = css.indexOf(selector);
  const end = next ? css.indexOf(next, start) : css.length;
  return css.slice(start, end);
}

describe('black theme accent', () => {
  const themes = readFileSync(join(process.cwd(), 'src/styles/themes.css'), 'utf8');
  const black = block(themes, 'html[data-theme="black"]', 'html[data-theme="discord"]');
  const discord = block(themes, 'html[data-theme="discord"]', '');
  const logo = readFileSync(join(process.cwd(), 'public/logo.svg'), 'utf8');

  it('uses the logo blue for the accent fill, border and text', () => {
    expect(logo).toContain('fill="#2b99e7"');
    expect(black).toContain('--color-accent-primary: #2b99e7;');
    expect(black).toContain('--color-accent-hover: #177bc3;');
    expect(black).toContain('--color-accent-text: #3ea2e9;');
    expect(black).toContain('--color-border-accent: #2b99e7;');
    expect(black).not.toContain('#5865f2');
    expect(black).not.toContain('#4c9cff');
  });

  it('puts ink on a solid accent, because white on the logo blue is 3.1:1', () => {
    expect(black).toContain('--primary-foreground: #000000;');
    expect(black).toContain('--accent-mark-filter: brightness(0);');
  });

  it('leaves the graphite theme on its own accent', () => {
    expect(discord).toContain('--color-accent-primary: #5865f2;');
    expect(discord).toContain('--color-accent-hover: #4752c4;');
  });

  it('leaves the Old theme accent in the base palette', () => {
    const base = readFileSync(join(process.cwd(), 'src/styles/index.css'), 'utf8');
    expect(base).toContain('--color-accent-primary: oklch(55.00% 0.1500 248.00);');
    expect(base).toContain('--primary-foreground: #ffffff;');
  });
});
