import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConnectionWidgetContent } from '@/features/profile/ConnectionWidgetContent';
describe('connected account widgets', () => {
  it('shows Steam covers and playtime', () => {
    render(<ConnectionWidgetContent data={{ kind: 'steam-games', items: [
      { id: '570', title: 'Dota 2', minutes: 90, imageUrl: '/api/media-proxy/example', url: 'https://store.steampowered.com/app/570/' },
    ] }} />);
    expect(screen.getByRole('link', { name: 'Dota 2' })).toHaveAttribute('href', 'https://store.steampowered.com/app/570/');
    expect(screen.getByText('1,5 h')).toBeInTheDocument();
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
