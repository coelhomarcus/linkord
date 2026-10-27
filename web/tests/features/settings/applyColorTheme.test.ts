import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyColorTheme } from '@/features/settings/applyColorTheme';

describe('applyColorTheme', () => {
  beforeEach(() => {
    if (!document.querySelector('meta[name="theme-color"]')) {
      const meta = document.createElement('meta');
      meta.setAttribute('name', 'theme-color');
      meta.setAttribute('content', '#0d0d0f');
      document.head.appendChild(meta);
    }
  });

  afterEach(() => {
    delete document.documentElement.dataset.theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#0d0d0f');
  });

  it('sets data-theme and theme-color meta', () => {
    applyColorTheme('discord');
    expect(document.documentElement.dataset.theme).toBe('discord');
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#202225');
  });

  it('paints the browser chrome with each theme\'s shell color', () => {
    applyColorTheme('light');
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#edeef1');
    applyColorTheme('black');
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#000000');
  });
});
