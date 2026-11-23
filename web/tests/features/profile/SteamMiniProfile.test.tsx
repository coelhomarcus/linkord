import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WallWidgetCard } from '@/features/profile/WallWidgetCard';
import { steamLevelColor } from '@/features/profile/steamLevel';
import type { WallWidget } from '@/features/profile/connectionsTypes';

const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock('motion/react', async (importOriginal) => ({ ...await importOriginal<typeof import('motion/react')>(), useReducedMotion: () => motion.reduced }));

const connection = {
  id: 'steam', provider: 'steam', value: 'example', url: 'https://steamcommunity.com/id/example', position: 0, showOnProfile: true,
  syncedAt: '2026-11-23T12:00:00Z', syncError: null, status: 'ready',
} as const;
const profile = { kind: 'steam-profile', name: 'Example', avatarUrl: '/api/media-proxy/steam/avatar?u=a', level: 47, owned: 1022, currentGame: 'Dota 2' } as const;
const items = {
  background: { imageUrl: '/api/media-proxy/steam/bg?u=b', webmUrl: '/api/media-proxy/steam-video/loop?u=c', mp4Url: '/api/media-proxy/steam-video/loop?u=d' },
  avatarFrameUrl: '/api/media-proxy/steam/frame?u=e',
  animatedAvatarUrl: '/api/media-proxy/steam/animated?u=f',
};
const widget = (data: WallWidget['data']): WallWidget => ({ connection, type: 'steam-profile', data });

describe('Steam mini profile widget', () => {
  it('is the mini profile alone, named for screen readers, with the name linking to the profile', () => {
    motion.reduced = false;
    const { container } = render(<WallWidgetCard widget={widget({ ...profile, items })} accent="#3366ff" />);
    expect(screen.getByRole('article', { name: 'Perfil Steam' })).toBeInTheDocument();
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.getByRole('link', { name: 'Steam, @example' })).toHaveAttribute('href', connection.url);
    const video = container.querySelector('video')!;
    expect(video).toHaveAttribute('poster', items.background.imageUrl);
    expect([...video.querySelectorAll('source')].map((source) => [source.getAttribute('src'), source.getAttribute('type')])).toEqual([
      [items.background.webmUrl, 'video/webm'], [items.background.mp4Url, 'video/mp4'],
    ]);
    expect(container.querySelector(`img[src="${items.animatedAvatarUrl}"]`)).toBeInTheDocument();
    expect(screen.getByTestId('steam-avatar-frame')).toHaveAttribute('src', items.avatarFrameUrl);
    expect(screen.getByText('Jogava Dota 2 na última sincronização')).toBeInTheDocument();
    expect(screen.getByText('47')).toHaveStyle({ borderColor: steamLevelColor(47) });
    expect(screen.getByText('1.022')).toBeInTheDocument();
  });

  it('holds still under reduced motion', () => {
    motion.reduced = true;
    const { container } = render(<WallWidgetCard widget={widget({ ...profile, items })} accent="#3366ff" />);
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector(`img[src="${items.background.imageUrl}"]`)).toBeInTheDocument();
    expect(screen.getByTestId('steam-avatar-frame').getAttribute('src')).toMatch(/^\/api\/media-proxy\/steam\/frame\?.*animated=false/);
    motion.reduced = false;
  });

  it('draws a profile with nothing equipped, or from an older snapshot, with its plain avatar', () => {
    const { container } = render(<WallWidgetCard widget={widget(profile)} accent="#3366ff" />);
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector(`img[src="${profile.avatarUrl}"]`)).toBeInTheDocument();
    expect(screen.queryByTestId('steam-avatar-frame')).toBeNull();
  });

  it('keeps the titled card while there is nothing to draw yet', () => {
    render(<WallWidgetCard widget={{ ...widget(null), connection: { ...connection, syncedAt: null, status: 'pending' } }} accent="#3366ff" />);
    expect(screen.getByRole('heading', { name: 'Perfil Steam' })).toBeInTheDocument();
  });

  it('rings each ten levels in its own colour, cycling past 100', () => {
    expect(steamLevelColor(0)).toBe(steamLevelColor(9));
    expect(steamLevelColor(10)).not.toBe(steamLevelColor(9));
    expect(steamLevelColor(147)).toBe(steamLevelColor(47));
  });
});
