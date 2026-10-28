import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PublicUser } from '@/shared/types/protocol';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { ProfileModal } from '@/features/profile/ProfileModal';
import * as api from '@/shared/api/api';
import type { ProfileDetails } from '@/shared/api/api';
import { initialRoomState } from '@/state/roomReducer';

// the relationship actions need the router and the friends provider — they
// have their own tests (tests/features/friends/ProfileActions.test.tsx)
vi.mock('@/features/friends/ProfileActions', () => ({ ProfileActions: () => null }));
vi.mock('@/shared/api/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/api/api')>()),
  fetchProfileDetails: vi.fn(),
}));
const mocked = vi.mocked(api);

const NOTHING: ProfileDetails = {
  memberSince: '2023-05-04T12:00:00.000Z', friendsSince: null,
  mutualFriends: { items: [], total: 0 }, mutualGroups: { items: [], total: 0 },
};
beforeEach(() => {
  mocked.fetchProfileDetails.mockReset().mockResolvedValue(NOTHING);
  localStorage.removeItem('linkord.profileMutualsHidden');
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
  it('opens avatar and banner in the same standardized frame, identifying the clicked image', async () => {
    const interaction = userEvent.setup();
    renderWithRoom(<ProfileModal userId="u1" onClose={vi.fn()} onOpenProfile={vi.fn()} />, {
      allUsers: new Map([[user.id, user]]),
    });

    await interaction.click(screen.getByRole('button', { name: 'Ver foto de perfil em tela cheia' }));
    expect(screen.getByRole('img', { name: 'Foto de perfil' })).toHaveAttribute('src', user.avatar);
    const avatarFrame = document.querySelector<HTMLElement>('[data-slot="image-lightbox-frame"]');
    expect(avatarFrame).toHaveStyle({ width: '80vw', maxWidth: '80vh' });
    expect(avatarFrame?.style.aspectRatio).toBe('1 / 1');

    await interaction.click(screen.getByRole('button', { name: 'Fechar' }));
    await interaction.click(screen.getByRole('button', { name: 'Ver banner em tela cheia' }));
    expect(screen.getByRole('img', { name: 'Banner' })).toHaveAttribute('src', user.banner);
    const bannerFrame = document.querySelector<HTMLElement>('[data-slot="image-lightbox-frame"]');
    expect(bannerFrame).toHaveStyle({ width: '80vw', maxWidth: `${(80 * 16) / 9}vh` });
    expect(bannerFrame?.style.aspectRatio).toBe(`${16 / 9} / 1`);
  });

  it('keeps the correct identification when avatar and banner use the same URL', async () => {
    const interaction = userEvent.setup();
    const sameUrlUser = { ...user, avatar: '/same-image.webp', banner: '/same-image.webp' };
    renderWithRoom(<ProfileModal userId="u1" onClose={vi.fn()} onOpenProfile={vi.fn()} />, {
      allUsers: new Map([[sameUrlUser.id, sameUrlUser]]),
    });

    await interaction.click(screen.getByRole('button', { name: 'Ver banner em tela cheia' }));
    expect(screen.getByRole('img', { name: 'Banner' })).toHaveAttribute('src', sameUrlUser.banner);
  });

  it('the card inside the modal has no border of its own (only the modal\'s) and the X stays legible over the banner', () => {
    renderWithRoom(<ProfileModal userId="u1" onClose={vi.fn()} onOpenProfile={vi.fn()} />, {
      allUsers: new Map([[user.id, user]]),
    });

    const content = document.querySelector('[data-slot="dialog-content"]')!;
    expect(content.querySelector('.border-strong')).toBeNull();
    expect(content.querySelector('.rounded-xl.border')).toBeNull();
    expect(content.querySelector('[data-slot="dialog-close"]')!.className).toContain('bg-black/60');
  });
});

describe('ProfileModal — since when and what you have in common', () => {
  const me = { ...initialRoomState, me: { ...initialRoomState.me, userId: 'me', displayName: 'Eu' } };
  const details: ProfileDetails = {
    memberSince: '2023-05-04T12:00:00.000Z',
    friendsSince: '2026-03-12T12:00:00.000Z',
    mutualFriends: { items: [{ id: 'f1', username: 'luis', displayName: 'Luis', avatar: '', avatarColor: 'green' }], total: 1 },
    mutualGroups: { items: [{ id: 'g1', title: 'os xerecas', avatar: '', memberCount: 5 }, { id: 'g2', title: 'trampo', avatar: '', memberCount: 1 }], total: 2 },
  };

  function renderProfile(overrides: Parameters<typeof renderWithRoom>[1] = {}, props: Partial<Parameters<typeof ProfileModal>[0]> = {}) {
    const onClose = vi.fn(); const onOpenProfile = vi.fn();
    renderWithRoom(<ProfileModal userId="u1" onClose={onClose} onOpenProfile={onOpenProfile} {...props} />, {
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

  it('counts the friends and groups in common on their tabs, and a friend opens their own profile', async () => {
    mocked.fetchProfileDetails.mockResolvedValue(details);
    const { onOpenProfile } = renderProfile();
    expect(await screen.findByRole('tab', { name: '1 amigo mútuo' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '2 grupos mútuos' })).toBeInTheDocument();
    const friend = screen.getByRole('button', { name: /Luis/ });
    expect(friend).toHaveTextContent('@luis · online');
    await userEvent.setup().click(friend);
    expect(onOpenProfile).toHaveBeenCalledWith('f1');
  });

  it('a group in common opens its conversation and closes the profile', async () => {
    mocked.fetchProfileDetails.mockResolvedValue(details);
    const openConversation = vi.fn(); const requestChatView = vi.fn();
    const { onClose } = renderProfile({ openConversation, requestChatView });
    const interaction = userEvent.setup();
    await interaction.click(await screen.findByRole('tab', { name: '2 grupos mútuos' }));
    const panel = screen.getByRole('tabpanel');
    expect(within(panel).getByText('5 membros')).toBeInTheDocument();
    expect(within(panel).getByText('1 membro')).toBeInTheDocument();
    await interaction.click(within(panel).getByRole('button', { name: /os xerecas/ }));
    expect(openConversation).toHaveBeenCalledWith('g1');
    expect(requestChatView).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('says so when there is nothing in common', async () => {
    renderProfile();
    expect(await screen.findByRole('tab', { name: '0 amigos mútuos' })).toBeInTheDocument();
    expect(screen.getByText('Nenhum amigo mútuo.')).toBeInTheDocument();
  });

  it('your own profile shows when you joined, with nothing in common to list', async () => {
    renderProfile({ state: { ...initialRoomState, me: { ...initialRoomState.me, userId: 'u1' } } });
    expect(await screen.findByText('Membro desde')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /mútuo/ })).not.toBeInTheDocument();
  });

  it('a failed load offers to try again', async () => {
    mocked.fetchProfileDetails.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(details);
    renderProfile();
    const retry = await screen.findByRole('button', { name: 'Tentar de novo' });
    await userEvent.setup().click(retry);
    expect(await screen.findByRole('tab', { name: '1 amigo mútuo' })).toBeInTheDocument();
  });

  it('a button beside the close button hides the side panel and shows it again, and the choice is remembered', async () => {
    mocked.fetchProfileDetails.mockResolvedValue(details);
    renderProfile();
    const interaction = userEvent.setup();
    expect(await screen.findByRole('tab', { name: '1 amigo mútuo' })).toBeInTheDocument();

    const hide = screen.getByRole('button', { name: 'Ocultar amigos e grupos em comum' });
    expect(hide).toHaveAttribute('aria-expanded', 'true');
    await interaction.click(hide);
    expect(screen.queryByRole('tab', { name: /mútuo/ })).not.toBeInTheDocument();
    // the profile card itself stays
    expect(screen.getByText('Membro desde')).toBeInTheDocument();
    expect(localStorage.getItem('linkord.profileMutualsHidden')).toBe('1');

    await interaction.click(screen.getByRole('button', { name: 'Mostrar amigos e grupos em comum' }));
    expect(screen.getByRole('tab', { name: '1 amigo mútuo' })).toBeInTheDocument();
    expect(localStorage.getItem('linkord.profileMutualsHidden')).toBe('0');
  });

  it('opens with the side panel hidden when it was last left hidden', async () => {
    localStorage.setItem('linkord.profileMutualsHidden', '1');
    mocked.fetchProfileDetails.mockResolvedValue(details);
    renderProfile();
    expect(await screen.findByText('Membro desde')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /mútuo/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mostrar amigos e grupos em comum' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('your own profile has no panel to toggle', async () => {
    renderProfile({ state: { ...initialRoomState, me: { ...initialRoomState.me, userId: 'u1' } } });
    expect(await screen.findByText('Membro desde')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /amigos e grupos em comum/ })).not.toBeInTheDocument();
  });
});
