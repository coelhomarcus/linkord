import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PublicUser } from '@/shared/types/protocol';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { MemoryRouter } from 'react-router';
import { ProfileModal } from '@/features/profile/ProfileModal';
import * as api from '@/shared/api/api';
import * as wallApi from '@/features/profile/profileApi';
import type { ProfileDetails } from '@/shared/api/api';
import { initialRoomState } from '@/state/roomReducer';

// the relationship actions need the router and the friends provider — they
// have their own tests (tests/features/friends/ProfileActions.test.tsx)
vi.mock('@/features/friends/ProfileActions', () => ({
  ProfileActions: () => <div data-testid="actions" />,
  EditProfileButton: () => <button type="button">Editar perfil</button>,
}));
vi.mock('@/shared/api/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/api/api')>()),
  fetchProfileDetails: vi.fn(),
}));
vi.mock('@/features/profile/profileApi', () => ({ fetchWall: vi.fn(), saveWall: vi.fn() }));
const mocked = vi.mocked(api);

function yesterdayAt1011(): string {
  const at = new Date();
  at.setDate(at.getDate() - 1);
  at.setHours(10, 11, 0, 0);
  return at.toISOString();
}

const NOTHING: ProfileDetails = {
  memberSince: '2023-05-04T12:00:00.000Z', friendsSince: null,
  mutualFriends: { items: [], total: 0 }, mutualServers: { items: [], total: 0 },
};
beforeEach(() => {
  mocked.fetchProfileDetails.mockReset().mockResolvedValue(NOTHING);
  vi.mocked(wallApi.fetchWall).mockReset().mockResolvedValue({ widgets: [], available: [] });
});

const user: PublicUser = {
  id: 'u1',
  username: 'marcus',
  displayName: 'Marcus',
  avatar: '/avatar-small.webp',
  avatarColor: 'blurple',
  banner: '/banner-small.webp',
  bio: '',
  profileLinks: [],
  role: 'user',
};

describe('ProfileModal', () => {
  it('does not offer image previews from the avatar or banner', () => {
    renderWithRoom(<MemoryRouter><ProfileModal userId="u1" onClose={vi.fn()} onOpenProfile={vi.fn()} /></MemoryRouter>, {
      allUsers: new Map([[user.id, user]]),
    });

    expect(screen.queryByRole('button', { name: 'Ver foto de perfil em tela cheia' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ver banner em tela cheia' })).not.toBeInTheDocument();
    expect(document.querySelector('[data-slot="image-lightbox-frame"]')).toBeNull();
  });

  it('the card inside the modal has no border of its own (only the modal\'s) and the X stays legible over the banner', () => {
    renderWithRoom(<MemoryRouter><ProfileModal userId="u1" onClose={vi.fn()} onOpenProfile={vi.fn()} /></MemoryRouter>, {
      allUsers: new Map([[user.id, user]]),
    });

    const content = document.querySelector('[data-slot="dialog-content"]')!;
    expect(content.querySelector('.border-strong')).toBeNull();
    expect(content.querySelector('.rounded-xl.border')).toBeNull();
    expect(content.querySelector('[data-slot="dialog-close"]')!.className).toContain('bg-bg-control');
    expect(content.querySelector('[data-slot="dialog-close"]')!.className).toContain('border-border-control');
  });
});

describe('ProfileModal — since when and what you have in common', () => {
  const me = { ...initialRoomState, me: { ...initialRoomState.me, userId: 'me', displayName: 'Eu' } };
  const details: ProfileDetails = {
    memberSince: '2023-05-04T12:00:00.000Z',
    friendsSince: '2026-03-12T12:00:00.000Z',
    mutualFriends: { items: [{ id: 'f1', username: 'luis', displayName: 'Luis', avatar: '', avatarColor: 'green' }], total: 1 },
    mutualServers: { items: [{ id: 'g1', name: 'os xerecas', icon: '', memberCount: 5 }, { id: 'g2', name: 'trampo', icon: '', memberCount: 1 }], total: 2 },
  };

  function renderProfile(overrides: Parameters<typeof renderWithRoom>[1] = {}, props: Partial<Parameters<typeof ProfileModal>[0]> = {}) {
    const onClose = vi.fn(); const onOpenProfile = vi.fn();
    renderWithRoom(<MemoryRouter><ProfileModal userId="u1" onClose={onClose} onOpenProfile={onOpenProfile} {...props} /></MemoryRouter>, {
      state: me, allUsers: new Map([[user.id, user]]), onlineUserIds: new Set(['f1']), ...overrides,
    });
    return { onClose, onOpenProfile };
  }

  it('shows since when the account exists and since when you are friends', async () => {
    mocked.fetchProfileDetails.mockResolvedValue(details);
    renderProfile();
    expect(await screen.findByText('Membro desde')).toBeInTheDocument();
    expect(screen.getByText('4 de mai. de 2023')).toBeInTheDocument();
    expect(screen.getByText('Amigos desde')).toBeInTheDocument();
    expect(screen.getByText('12 de mar. de 2026')).toBeInTheDocument();
  });

  it('leaves out "Amigos desde" when you are not friends', async () => {
    mocked.fetchProfileDetails.mockResolvedValue({ ...details, friendsSince: null });
    renderProfile();
    expect(await screen.findByText('Membro desde')).toBeInTheDocument();
    expect(screen.queryByText('Amigos desde')).not.toBeInTheDocument();
  });

  it('puts the Wall first beside the mutual tabs and keeps the profile card visible', async () => {
    mocked.fetchProfileDetails.mockResolvedValue(details);
    renderProfile();
    await screen.findByRole('tab', { name: '2 servidores em comum' });
    const tabs = within(screen.getByRole('tablist', { name: 'Abas do perfil' })).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Mural', '2 servidores em comum', '1 amigo mútuo']);
    expect(screen.getAllByRole('tablist')).toHaveLength(1);
    expect(screen.queryByRole('tab', { name: 'Sobre' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Marcus' })).toBeInTheDocument();
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('a friend in common opens their own profile', async () => {
    mocked.fetchProfileDetails.mockResolvedValue(details);
    const { onOpenProfile } = renderProfile();
    const interaction = userEvent.setup();
    await interaction.click(await screen.findByRole('tab', { name: '1 amigo mútuo' }));
    const friend = screen.getByRole('button', { name: /Luis/ });
    expect(friend).toHaveTextContent('@luis · online');
    await interaction.click(friend);
    expect(onOpenProfile).toHaveBeenCalledWith('f1');
  });

  it('a server in common opens it and closes the profile', async () => {
    mocked.fetchProfileDetails.mockResolvedValue(details);
    const { onClose } = renderProfile();
    const interaction = userEvent.setup();
    await interaction.click(await screen.findByRole('tab', { name: '2 servidores em comum' }));
    expect(screen.getByRole('tab', { name: '2 servidores em comum' })).toHaveAttribute('aria-selected', 'true');
    const panel = screen.getByRole('tabpanel', { name: '2 servidores em comum' });
    expect(within(panel).getByText('5 membros')).toBeInTheDocument();
    expect(within(panel).getByText('1 membro')).toBeInTheDocument();
    await interaction.click(within(panel).getByRole('button', { name: /os xerecas/ }));
    expect(onClose).toHaveBeenCalled();
  });

  it('says so when there is nothing in common', async () => {
    renderProfile();
    await userEvent.setup().click(await screen.findByRole('tab', { name: '0 servidores em comum' }));
    expect(screen.getByText('Nenhum servidor em comum.')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('tab', { name: '0 amigos mútuos' }));
    expect(screen.getByText('Nenhum amigo mútuo.')).toBeInTheDocument();
  });

  it('shows the sidebar on your own profile with only the editable Wall', async () => {
    renderProfile({ state: { ...initialRoomState, me: { ...initialRoomState.me, userId: 'u1' } } });
    expect(await screen.findByText('Membro desde')).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Mural']);
    expect(screen.getByRole('tab', { name: 'Mural' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('button', { name: 'Editar Mural' })).toBeInTheDocument();
    expect(screen.queryByText(/servidores em comum|amigos mútuos/i)).not.toBeInTheDocument();
    expect(vi.mocked(wallApi.fetchWall)).toHaveBeenCalledWith('u1', true, expect.any(AbortSignal));
  });

  it('never shows when the user was last online', async () => {
    renderProfile({ allUsers: new Map([[user.id, { ...user, lastSeenAt: yesterdayAt1011() }]]) });
    expect(await screen.findByText('Membro desde')).toBeInTheDocument();
    expect(screen.queryByText('Última vez online')).not.toBeInTheDocument();
    expect(screen.queryByText(/ontem às/)).not.toBeInTheDocument();
    expect(screen.queryByText('Status')).not.toBeInTheDocument();
  });

  it('lists the connections under their label, one per line, opening the site', async () => {
    mocked.fetchProfileDetails.mockResolvedValue(details);
    renderProfile({ allUsers: new Map([[user.id, { ...user, profileLinks: ['https://open.spotify.com/user/x', 'https://github.com/marcus'] }]]) });
    expect(await screen.findByRole('heading', { name: 'Conexões' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Abrir Spotify' })).toHaveAttribute('href', 'https://open.spotify.com/user/x');
    expect(screen.getByRole('link', { name: 'Abrir GitHub' })).toHaveAttribute('href', 'https://github.com/marcus');
  });

  it('has no Conexões section for a profile without links', async () => {
    mocked.fetchProfileDetails.mockResolvedValue(details);
    renderProfile();
    expect(await screen.findByText('Membro desde')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Conexões' })).not.toBeInTheDocument();
  });

  it('on your own profile the edit button sits on the name line, with no action row', async () => {
    renderProfile({ state: { ...initialRoomState, me: { ...initialRoomState.me, userId: 'u1' } } });
    const edit = await screen.findByRole('button', { name: 'Editar perfil' });
    expect(edit.closest('div')?.parentElement).toContainElement(screen.getByRole('heading', { name: 'Marcus' }));
    expect(screen.queryByTestId('actions')).not.toBeInTheDocument();
  });

  it("on someone else's profile the actions are below, with no edit button", async () => {
    renderProfile();
    expect(await screen.findByTestId('actions')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar perfil' })).not.toBeInTheDocument();
  });

  it('a failed load offers to try again', async () => {
    mocked.fetchProfileDetails.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(details);
    renderProfile();
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Servidores em comum' }));
    const retry = await screen.findByRole('button', { name: 'Tentar de novo' });
    await userEvent.setup().click(retry);
    expect(await screen.findByRole('tab', { name: '1 amigo mútuo' })).toBeInTheDocument();
  });

  it('keeps the Wall available when mutual details cannot be loaded', async () => {
    mocked.fetchProfileDetails.mockRejectedValue(new Error('offline'));
    renderProfile();
    expect(await screen.findByText('Este usuário ainda não publicou widgets no Mural.')).toBeInTheDocument();
    expect(screen.queryByText('Não foi possível carregar o que vocês têm em comum.')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Mural' })).toHaveAttribute('aria-selected', 'true');
  });

  it('opens the Wall when navigating to another profile from a mutual friend', async () => {
    mocked.fetchProfileDetails.mockResolvedValue(details);
    function ProfileHarness() {
      const [userId, setUserId] = useState('u1');
      return <ProfileModal userId={userId} onClose={vi.fn()} onOpenProfile={setUserId} />;
    }
    const friend = { ...user, id: 'f1', username: 'luis', displayName: 'Luis' };
    renderWithRoom(<MemoryRouter><ProfileHarness /></MemoryRouter>, {
      state: me, allUsers: new Map([[user.id, user], [friend.id, friend]]),
    });
    const interaction = userEvent.setup();
    await interaction.click(await screen.findByRole('tab', { name: '1 amigo mútuo' }));
    await interaction.click(screen.getByRole('button', { name: /Luis/ }));
    expect(await screen.findByRole('heading', { name: 'Luis' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Mural' })).toHaveAttribute('aria-selected', 'true');
  });

  it('supports keyboard navigation from the Wall to mutual servers', async () => {
    mocked.fetchProfileDetails.mockResolvedValue(details);
    renderProfile();
    await screen.findByRole('tab', { name: '2 servidores em comum' });
    const interaction = userEvent.setup();
    await interaction.click(screen.getByRole('tab', { name: 'Mural' }));
    await interaction.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: '2 servidores em comum' })).toHaveFocus();
    await interaction.keyboard('{Enter}');
    expect(screen.getByRole('tab', { name: '2 servidores em comum' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: 'Marcus' })).toBeInTheDocument();
  });

  it('the side panel is always there: nothing hides it', async () => {
    mocked.fetchProfileDetails.mockResolvedValue(details);
    renderProfile();
    expect(await screen.findByRole('tab', { name: '1 amigo mútuo' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /amigos e servidores em comum/ })).not.toBeInTheDocument();
  });
});
