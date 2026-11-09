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
    // the Wall's widget cards (and their loading shapes) are bordered on purpose
    const bordered = [...content.querySelectorAll('.rounded-xl.border')].filter((element) => !element.closest('section[aria-label="Mural"]'));
    expect(bordered).toEqual([]);
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
    const memberSince = await screen.findByText('Membro desde');
    expect(memberSince).toHaveClass('text-caption');
    expect(screen.getByText('4 de mai. de 2023')).toHaveClass('text-label');
    expect(screen.getByText('Amigos desde')).toHaveClass('text-caption');
    expect(screen.getByText('12 de mar. de 2026')).toHaveClass('text-label');
  });

  it('titles the bio like the other fields, and leaves the title out without a bio', async () => {
    mocked.fetchProfileDetails.mockResolvedValue(details);
    renderProfile({ allUsers: new Map([[user.id, { ...user, bio: 'hello there' }]]) });
    expect(screen.getByText('hello there')).toHaveClass('text-label');
    expect(screen.getByRole('heading', { name: 'Bio' })).toHaveClass('text-caption');
    await screen.findByText('Membro desde');
  });

  it('shows no bio title when the user has no bio', async () => {
    mocked.fetchProfileDetails.mockResolvedValue(details);
    renderProfile();
    await screen.findByText('Membro desde');
    expect(screen.queryByRole('heading', { name: 'Bio' })).not.toBeInTheDocument();
  });

  it('leaves out "Amigos desde" when you are not friends', async () => {
    mocked.fetchProfileDetails.mockResolvedValue({ ...details, friendsSince: null });
    renderProfile();
    expect(await screen.findByText('Membro desde')).toBeInTheDocument();
    expect(screen.queryByText('Amigos desde')).not.toBeInTheDocument();
  });

  it('puts the Wall first beside the shared tab and keeps the profile card visible', async () => {
    mocked.fetchProfileDetails.mockResolvedValue(details);
    renderProfile();
    await screen.findByRole('tab', { name: 'Em comum' });
    const tabs = within(screen.getByRole('tablist', { name: 'Abas do perfil' })).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Mural', 'Em comum']);
    expect(screen.getAllByRole('tablist')).toHaveLength(1);
    expect(screen.queryByRole('tab', { name: 'Sobre' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Marcus' })).toBeInTheDocument();
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('opens straight on the shared tab when asked to', async () => {
    mocked.fetchProfileDetails.mockResolvedValue(details);
    renderProfile({}, { initialTab: 'common' });
    expect(await screen.findByRole('tab', { name: 'Em comum' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('button', { name: /Luis/ })).toBeVisible();
  });

  it('a friend in common opens their own profile', async () => {
    mocked.fetchProfileDetails.mockResolvedValue(details);
    const { onOpenProfile } = renderProfile();
    const interaction = userEvent.setup();
    await interaction.click(await screen.findByRole('tab', { name: 'Em comum' }));
    const friend = screen.getByRole('button', { name: /Luis/ });
    expect(friend).toHaveTextContent('@luis · online');
    await interaction.click(friend);
    expect(onOpenProfile).toHaveBeenCalledWith('f1');
  });

  it('lists servers and friends in the same tab, and a server opens it', async () => {
    mocked.fetchProfileDetails.mockResolvedValue(details);
    const { onClose } = renderProfile();
    const interaction = userEvent.setup();
    await interaction.click(await screen.findByRole('tab', { name: 'Em comum' }));
    expect(screen.getByRole('tab', { name: 'Em comum' })).toHaveAttribute('aria-selected', 'true');
    const panel = screen.getByRole('tabpanel', { name: 'Em comum' });
    expect(within(panel).getByRole('heading', { name: 'Servidores em comum' })).toBeInTheDocument();
    expect(within(panel).getByRole('heading', { name: 'Amigos mútuos' })).toBeInTheDocument();
    expect(within(panel).getByText('5 membros')).toBeInTheDocument();
    expect(within(panel).getByText('1 membro')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: /Luis/ })).toBeInTheDocument();
    await interaction.click(within(panel).getByRole('button', { name: /os xerecas/ }));
    expect(onClose).toHaveBeenCalled();
  });

  it('says so when there is nothing in common', async () => {
    renderProfile();
    await userEvent.setup().click(await screen.findByRole('tab', { name: 'Em comum' }));
    expect(screen.getByText('Nenhum servidor em comum.')).toBeInTheDocument();
    expect(screen.getByText('Nenhum amigo mútuo.')).toBeInTheDocument();
  });

  it('shows the sidebar on your own profile with only the editable Wall', async () => {
    renderProfile({ state: { ...initialRoomState, me: { ...initialRoomState.me, userId: 'u1' } } });
    expect(await screen.findByText('Membro desde')).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Mural']);
    expect(screen.getByRole('tab', { name: 'Mural' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('button', { name: 'Adicionar widget' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Seus Widgets' })).toBeInTheDocument();
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
    const spotify = screen.getByRole('link', { name: 'Abrir Spotify' });
    const github = screen.getByRole('link', { name: 'Abrir GitHub' });
    expect(spotify).toHaveAttribute('href', 'https://open.spotify.com/user/x');
    expect(spotify).toHaveTextContent('Spotify');
    expect(github).toHaveAttribute('href', 'https://github.com/marcus');
    expect(github).toHaveTextContent('GitHub');
    expect(spotify.closest('ul')).toHaveClass('flex-col');
  });

  it('has no Conexões section for a profile without links', async () => {
    mocked.fetchProfileDetails.mockResolvedValue(details);
    renderProfile();
    expect(await screen.findByText('Membro desde')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Conexões' })).not.toBeInTheDocument();
  });

  it('your own profile opens as the editor, with no action row', async () => {
    renderProfile({ state: { ...initialRoomState, me: { ...initialRoomState.me, userId: 'u1', name: 'marcus', displayName: 'Marcus' } } });
    expect(await screen.findByLabelText('Nome de exibição')).toBeInTheDocument();
    expect(screen.getByLabelText('Bio')).toBeInTheDocument();
    expect(screen.queryByTestId('actions')).not.toBeInTheDocument();
  });

  it("someone else's profile is read-only, with the actions below", async () => {
    renderProfile();
    expect(await screen.findByTestId('actions')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Marcus' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Nome de exibição')).not.toBeInTheDocument();
  });

  it("someone else's custom status shows as a bubble beside the avatar, with no owner buttons", async () => {
    renderProfile({
      onlineUserIds: new Set(['u1']),
      presenceByUser: new Map([['u1', { status: 'online', customStatus: { emoji: '🎮', text: 'jogando Elden Ring', expiresAt: null } }]]),
    });
    const text = await screen.findByText('jogando Elden Ring');
    expect(text.closest('[data-custom-status-bubble]')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Editar status personalizado' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Definir status personalizado' })).not.toBeInTheDocument();
  });

  it('your own profile invites you to set a custom status, opening the editor', async () => {
    renderProfile({ state: { ...initialRoomState, me: { ...initialRoomState.me, userId: 'u1', name: 'marcus', displayName: 'Marcus' } } });
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Definir status personalizado' }));
    expect(await screen.findByRole('dialog', { name: 'Status personalizado' })).toBeInTheDocument();
  });

  it('a failed load offers to try again', async () => {
    mocked.fetchProfileDetails.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(details);
    renderProfile();
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Em comum' }));
    const retry = await screen.findByRole('button', { name: 'Tentar de novo' });
    await userEvent.setup().click(retry);
    expect(await screen.findByRole('button', { name: /Luis/ })).toBeInTheDocument();
  });

  it('does not reload the wall when switching to what you have in common', async () => {
    mocked.fetchProfileDetails.mockResolvedValue(details);
    renderProfile();
    expect(await screen.findByText('Este usuário ainda não publicou widgets no Mural.')).toBeInTheDocument();
    const calls = vi.mocked(wallApi.fetchWall).mock.calls.length;
    const interaction = userEvent.setup();
    await interaction.click(screen.getByRole('tab', { name: 'Em comum' }));
    await interaction.click(screen.getByRole('tab', { name: 'Mural' }));
    expect(screen.getByText('Este usuário ainda não publicou widgets no Mural.')).toBeInTheDocument();
    expect(screen.queryByText('Carregando Mural…')).not.toBeInTheDocument();
    expect(vi.mocked(wallApi.fetchWall).mock.calls.length).toBe(calls);
  });

  it('keeps the Wall available when mutual details cannot be loaded', async () => {
    mocked.fetchProfileDetails.mockRejectedValue(new Error('offline'));
    renderProfile();
    expect(await screen.findByText('Este usuário ainda não publicou widgets no Mural.')).toBeInTheDocument();
    const wall = screen.getByRole('tabpanel', { name: 'Mural' });
    expect(within(wall).queryByText('Não foi possível carregar o que vocês têm em comum.')).not.toBeInTheDocument();
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
    await interaction.click(await screen.findByRole('tab', { name: 'Em comum' }));
    await interaction.click(screen.getByRole('button', { name: /Luis/ }));
    expect(await screen.findByRole('heading', { name: 'Luis' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Mural' })).toHaveAttribute('aria-selected', 'true');
  });

  it('supports keyboard navigation from the Wall to what you have in common', async () => {
    mocked.fetchProfileDetails.mockResolvedValue(details);
    renderProfile();
    await screen.findByRole('tab', { name: 'Em comum' });
    const interaction = userEvent.setup();
    await interaction.click(screen.getByRole('tab', { name: 'Mural' }));
    await interaction.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Em comum' })).toHaveFocus();
    await interaction.keyboard('{Enter}');
    expect(screen.getByRole('tab', { name: 'Em comum' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: 'Marcus' })).toBeInTheDocument();
  });

  it('the side panel is always there: nothing hides it', async () => {
    mocked.fetchProfileDetails.mockResolvedValue(details);
    renderProfile();
    expect(await screen.findByRole('tab', { name: 'Em comum' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /amigos e servidores em comum/ })).not.toBeInTheDocument();
  });
});
