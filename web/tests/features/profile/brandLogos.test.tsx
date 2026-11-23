import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BrandLogo } from '@/features/profile/brandLogos';
import type { LinkKind } from '@/features/profile/profileLinks';

const KINDS: LinkKind[] = [
  'youtube', 'twitter', 'twitch', 'instagram', 'github', 'linkedin', 'tiktok', 'spotify', 'discord', 'steam', 'reddit',
  'facebook', 'threads', 'bluesky', 'telegram', 'soundcloud', 'pinterest', 'snapchat', 'kick', 'epicgames', 'xbox',
  'behance', 'dribbble', 'vk', 'whatsapp', 'myanimelist', 'igdb', 'generic',
];

describe('BrandLogo', () => {
  it('draws a logo for every kind of link', () => {
    for (const kind of KINDS) {
      const { container, unmount } = render(<BrandLogo kind={kind} size={24} />);
      expect(container.querySelector('svg'), kind).not.toBeNull();
      unmount();
    }
  });

  it('keeps full-colour logos at the requested size', () => {
    const { container } = render(<BrandLogo kind="youtube" size={26} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('26');
    expect(svg?.getAttribute('height')).toBe('26');
  });

  it('paints a brand with a dark mark in the text colour', () => {
    const { container } = render(<BrandLogo kind="github" />);
    expect(container.querySelector('svg')?.getAttribute('fill')).toBe('currentColor');
  });
});
