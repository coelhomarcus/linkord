import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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

  it('keeps the Steam banner tile and link usable when the image fails', () => {
    const item = { id: '3764200', title: 'Resident Evil Requiem', minutes: 90,
      imageUrl: '/api/media-proxy/steam/original', url: 'https://store.steampowered.com/app/3764200/' };
    const { rerender } = render(<ConnectionWidgetContent data={{ kind: 'steam-games', items: [item] }} />);
    const tile = screen.getByRole('link', { name: item.title });
    expect(tile).toHaveClass('aspect-[460/215]');
    fireEvent.error(tile.querySelector('img')!);
    expect(tile.querySelector('img')).toBeNull();
    expect(tile).toHaveTextContent(item.title);
    expect(tile).toHaveAttribute('href', item.url);

    rerender(<ConnectionWidgetContent data={{ kind: 'steam-games', items: [{ ...item, imageUrl: '/api/media-proxy/steam/updated' }] }} />);
    expect(tile.querySelector('img')).toHaveAttribute('src', '/api/media-proxy/steam/updated');
  });

  it('shows an offline Twitch channel with its banner and can play a live stream in the widget', async () => {
    const user = userEvent.setup();
    const account = { kind: 'twitch-live', login: 'example', name: 'Example', avatarUrl: null, lastStreamAt: '2026-11-23T14:00:00Z' } as const;
    const { container, rerender } = render(<ConnectionWidgetContent data={{ ...account, status: 'offline', stream: null, offlineImageUrl: '/api/media-proxy/banner' }} />);
    expect(screen.getByText(/^Offline · Última transmissão em 23 de nov\. de 2026$/)).toBeInTheDocument();
    expect(container.querySelector('img[src="/api/media-proxy/banner"]')).toBeInTheDocument();
    rerender(<ConnectionWidgetContent data={{ ...account, status: 'live', stream: { title: 'Playing now', game: 'Dota 2', viewers: 1234, imageUrl: null } }} />);
    expect(container.querySelector('img[src="/api/media-proxy/banner"]')).not.toBeInTheDocument();
    expect(screen.getByText('Ao vivo', { selector: '.sr-only' })).toBeInTheDocument();
    expect(screen.getByText('Playing now')).toBeInTheDocument();
    expect(screen.getByText('1.234 espectadores')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /example/ }));
    expect(screen.getByTitle('Twitch')).toHaveAttribute('src', expect.stringContaining('player.twitch.tv/?channel=example'));
  });

  it('says only the status when the live state could not be read', () => {
    render(<ConnectionWidgetContent data={{ kind: 'twitch-live', login: 'example', name: 'Example', avatarUrl: null,
      lastStreamAt: '2026-11-23T14:00:00Z', stream: null, status: 'unknown', offlineImageUrl: '/api/media-proxy/banner' }} />);
    expect(screen.getByText('Status da transmissão indisponível')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('links Twitch VODs with their length on the thumbnail and their date', () => {
    render(<ConnectionWidgetContent data={{ kind: 'twitch-vods', items: [
      { id: '510', title: 'Replay', createdAt: '2026-11-23T14:00:00Z', seconds: 13330, imageUrl: null, url: 'https://www.twitch.tv/videos/510' },
    ] }} />);
    const link = screen.getByRole('link', { name: 'Replay, 23 de nov. de 2026, 3,7 h' });
    expect(link).toHaveAttribute('href', 'https://www.twitch.tv/videos/510');
    expect(link).toHaveTextContent('3:42:10');
    expect(link).toHaveTextContent('23 de nov.');
  });
});
