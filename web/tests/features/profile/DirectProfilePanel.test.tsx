import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { DirectProfilePanel } from '@/features/profile/DirectProfilePanel';
import * as api from '@/shared/api/api';
import type { PublicUser } from '@/shared/types/protocol';

vi.mock('@/shared/api/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/api/api')>()),
  fetchProfileDetails: vi.fn(),
}));
const mocked = vi.mocked(api);

const bea: PublicUser = { id: 'u-bea', username: 'bea', displayName: 'Bea', avatar: '', avatarColor: 'green', banner: '', bio: 'oi, eu sou a Bea', profileLinks: [], role: 'user' };

function yesterdayAt1011(): string {
  const at = new Date();
  at.setDate(at.getDate() - 1);
  at.setHours(10, 11, 0, 0);
  return at.toISOString();
}

beforeEach(() => {
  mocked.fetchProfileDetails.mockReset().mockResolvedValue({
    memberSince: '2023-05-04T12:00:00.000Z', friendsSince: null,
    mutualFriends: { items: [{ id: 'u-luis', username: 'luis', displayName: 'Luis', avatar: '', avatarColor: '' }], total: 1 },
    mutualServers: { items: [{ id: 's1', name: 'Squad', icon: '', memberCount: 4 }], total: 1 },
  });
});

describe('DirectProfilePanel', () => {
  it('shows who the DM is with, since when, and what you share', async () => {
    renderWithRoom(<MemoryRouter><DirectProfilePanel user={bea} onOpenProfile={vi.fn()} /></MemoryRouter>, { onlineUserIds: new Set(['u-bea']) });
    expect(screen.getByRole('heading', { name: 'Bea' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Bio' })).toBeInTheDocument();
    expect(screen.getByText('oi, eu sou a Bea')).toBeInTheDocument();
    expect(screen.getByText('bea').parentElement?.querySelector('svg')).toBeInTheDocument();
    expect(screen.getByLabelText('Online')).toBeInTheDocument();
    expect(await screen.findByText('4 de mai. de 2023')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '1 servidor em comum' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '1 amigo em comum' })).toBeInTheDocument();
  });

  it('never shows when the user was last online, only whether they are online now', async () => {
    renderWithRoom(<MemoryRouter><DirectProfilePanel user={{ ...bea, lastSeenAt: yesterdayAt1011() }} onOpenProfile={vi.fn()} /></MemoryRouter>);
    expect(await screen.findByText('4 de mai. de 2023')).toBeInTheDocument();
    expect(screen.queryByText('Última vez online')).not.toBeInTheDocument();
    expect(screen.queryByText(/ontem às/)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Status' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Offline')).toBeInTheDocument();
  });

  it('a mutual friend and the footer open profiles', async () => {
    const onOpenProfile = vi.fn();
    renderWithRoom(<MemoryRouter><DirectProfilePanel user={bea} onOpenProfile={onOpenProfile} /></MemoryRouter>);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Luis/ }));
    expect(onOpenProfile).toHaveBeenCalledWith('u-luis');
    await user.click(screen.getByRole('button', { name: 'Ver perfil completo' }));
    expect(onOpenProfile).toHaveBeenCalledWith('u-bea');
  });

  it('the mutuals line under the name opens the full profile on what you have in common', async () => {
    const onOpenProfile = vi.fn();
    renderWithRoom(<MemoryRouter><DirectProfilePanel user={bea} onOpenProfile={onOpenProfile} /></MemoryRouter>);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: '1 amigo mútuo' }));
    expect(onOpenProfile).toHaveBeenLastCalledWith('u-bea', 'common');
    await user.click(screen.getByRole('button', { name: '1 servidor em comum' }));
    expect(onOpenProfile).toHaveBeenLastCalledWith('u-bea', 'common');
  });
});
