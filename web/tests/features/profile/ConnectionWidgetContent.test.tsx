import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConnectionWidgetContent } from '@/features/profile/ConnectionWidgetContent';
import { steamLevelColor } from '@/features/profile/steamLevel';

const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock('motion/react', async (importOriginal) => ({ ...await importOriginal<typeof import('motion/react')>(), useReducedMotion: () => motion.reduced }));

const steamProfile = { kind: 'steam-profile', name: 'Example', avatarUrl: '/api/media-proxy/steam/avatar?u=a', level: 47, owned: 1022, currentGame: 'Dota 2' } as const;
const steamItems = {
  background: { imageUrl: '/api/media-proxy/steam/bg?u=b', webmUrl: '/api/media-proxy/steam-video/loop?u=c', mp4Url: '/api/media-proxy/steam-video/loop?u=d' },
  avatarFrameUrl: '/api/media-proxy/steam/frame?u=e',
  animatedAvatarUrl: '/api/media-proxy/steam/animated?u=f',
};

describe('connected account widgets', () => {
  it('shows Steam covers and playtime', () => {
    render(<ConnectionWidgetContent data={{ kind: 'steam-games', items: [
      { id: '570', title: 'Dota 2', minutes: 90, imageUrl: '/api/media-proxy/example', url: 'https://store.steampowered.com/app/570/' },
    ] }} />);
    expect(screen.getByRole('link', { name: 'Dota 2' })).toHaveAttribute('href', 'https://store.steampowered.com/app/570/');
    expect(screen.getByText('1,5 h')).toBeInTheDocument();
  });

  it('draws the Steam mini profile with its background loop, framed animated avatar and level', () => {
    motion.reduced = false;
    const { container } = render(<ConnectionWidgetContent data={{ ...steamProfile, items: steamItems }} />);
    const video = container.querySelector('video')!;
    expect(video).toHaveAttribute('poster', steamItems.background.imageUrl);
    expect([...video.querySelectorAll('source')].map((source) => [source.getAttribute('src'), source.getAttribute('type')])).toEqual([
      [steamItems.background.webmUrl, 'video/webm'], [steamItems.background.mp4Url, 'video/mp4'],
    ]);
    expect(container.querySelector(`img[src="${steamItems.animatedAvatarUrl}"]`)).toBeInTheDocument();
    expect(screen.getByTestId('steam-avatar-frame')).toHaveAttribute('src', steamItems.avatarFrameUrl);
    expect(screen.getByText('Example')).toBeInTheDocument();
    expect(screen.getByText('Jogava Dota 2 na última sincronização')).toBeInTheDocument();
    expect(screen.getByText('47')).toHaveStyle({ borderColor: steamLevelColor(47) });
    expect(screen.getByText('1.022')).toBeInTheDocument();
  });

  it('holds the Steam mini profile still under reduced motion', () => {
    motion.reduced = true;
    const { container } = render(<ConnectionWidgetContent data={{ ...steamProfile, items: steamItems }} />);
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector(`img[src="${steamItems.background.imageUrl}"]`)).toBeInTheDocument();
    expect(screen.getByTestId('steam-avatar-frame').getAttribute('src')).toMatch(/^\/api\/media-proxy\/steam\/frame\?.*animated=false/);
    motion.reduced = false;
  });

  it('draws a Steam profile with nothing equipped, or from an older snapshot, with its plain avatar', () => {
    const { container } = render(<ConnectionWidgetContent data={steamProfile} />);
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector(`img[src="${steamProfile.avatarUrl}"]`)).toBeInTheDocument();
    expect(screen.queryByTestId('steam-avatar-frame')).toBeNull();
  });

  it('rings each ten Steam levels in its own colour, cycling past 100', () => {
    expect(steamLevelColor(0)).toBe(steamLevelColor(9));
    expect(steamLevelColor(10)).not.toBe(steamLevelColor(9));
    expect(steamLevelColor(147)).toBe(steamLevelColor(47));
  });

  it('shows an offline Twitch account and can play a live stream in the widget', async () => {
    const user = userEvent.setup();
    const account = { kind: 'twitch-live', login: 'example', name: 'Example', avatarUrl: null, lastStreamAt: '2026-11-23T14:00:00Z' } as const;
    const { rerender } = render(<ConnectionWidgetContent data={{ ...account, status: 'offline', stream: null }} />);
    expect(screen.getByText('Offline')).toBeInTheDocument();
    expect(screen.getByText(/Última transmissão arquivada/)).toBeInTheDocument();
    rerender(<ConnectionWidgetContent data={{ ...account, status: 'live', stream: { title: 'Playing now', game: 'Dota 2', viewers: 8, imageUrl: null } }} />);
    expect(screen.getByText('Ao vivo')).toBeInTheDocument();
    expect(screen.getByText('Playing now')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /example/ }));
    expect(screen.getByTitle('Twitch')).toHaveAttribute('src', expect.stringContaining('player.twitch.tv/?channel=example'));
  });

  it('links Twitch VODs with their dates and durations', () => {
    render(<ConnectionWidgetContent data={{ kind: 'twitch-vods', items: [
      { id: '510', title: 'Replay', createdAt: '2026-11-23T14:00:00Z', seconds: 1500, imageUrl: null, url: 'https://www.twitch.tv/videos/510' },
    ] }} />);
    expect(screen.getByRole('link', { name: 'Replay' })).toHaveAttribute('href', 'https://www.twitch.tv/videos/510');
    expect(screen.getByText(/25 min/)).toBeInTheDocument();
  });
});
