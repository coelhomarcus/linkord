import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initialRoomState } from '@/state/roomReducer';
import { renderSocial, ana, bea } from '@tests/fixtures/socialFixture';
import { SidebarProvider } from '@/shared/ui/motion/sidebar';
import { GroupDetailsPanel } from '@/features/conversations/GroupDetailsPanel';
import * as api from '@/shared/api/api';
import type { Conversation, PublicUser } from '@/shared/types/protocol';

const uploadCroppedProfileImage = vi.hoisted(() => vi.fn());

vi.mock('@/features/settings/uploadCroppedProfileImage', () => ({
  uploadCroppedProfileImage,
}));

// portaled like the real dialog, which opens over the group modal
vi.mock('@/features/settings/ImageCropDialog', async () => {
  const { createPortal } = await import('react-dom');
  return {
    ImageCropDialog: ({ open, processing, onConfirm, onCancel }: { open: boolean; processing?: boolean; onConfirm: (crop: { x: number; y: number; width: number; height: number }) => void; onCancel: () => void }) => (
      open ? createPortal(
        <div>
          {processing && <p role="status">Processando imagem…</p>}
          <button type="button" disabled={processing} onClick={() => onConfirm({ x: 0, y: 0, width: 10, height: 10 })}>Confirmar recorte</button>
          <button type="button" disabled={processing} onClick={onCancel}>Cancelar recorte</button>
        </div>,
        document.body,
      ) : null
    ),
  };
});

vi.mock('@/shared/api/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/api/api')>()),
  fetchFriends: vi.fn(), fetchGroupMembers: vi.fn(), fetchRequestSummary: vi.fn(), fetchGroupInvitations: vi.fn(), inviteToGroup: vi.fn(), revokeInvitation: vi.fn(),
}));
const mocked = vi.mocked(api);

const pub = (u: typeof ana): PublicUser => ({ ...u, banner: '', bio: '', profileLinks: [] } as unknown as PublicUser);
const group = (myRole: 'owner' | 'member'): Conversation => ({
  id: 'g1', type: 'group', title: 'Squad', avatar: '', createdBy: 'me', memberIds: ['me', 'u-ana'],
  lastMessageAt: null, createdAt: 1, updatedAt: 1, pinnedAt: null, myRole, ownerId: 'me', memberCount: 2,
});
const friends = (...users: (typeof ana)[]) => ({ items: users.map((user) => ({ user, at: '2026-01-01T00:00:00.000Z' })), nextCursor: null });

const me = { id: 'me', username: 'eu', displayName: 'Eu', avatar: '', avatarColor: 'green' };
const memberPage = (nextCursor: string | null = null) => ({
  items: [{ user: me, role: 'owner' as const, at: '2026-01-01T00:00:00.000Z' }, { user: ana, role: 'member' as const, at: '2026-01-02T00:00:00.000Z' }],
  nextCursor,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocked.fetchGroupMembers.mockResolvedValue(memberPage());
  mocked.fetchRequestSummary.mockResolvedValue({ incoming: 0, invitations: 0 });
  mocked.fetchFriends.mockResolvedValue(friends(ana, bea));
  mocked.fetchGroupInvitations.mockResolvedValue({ items: [], nextCursor: null });
});

function setup(myRole: 'owner' | 'member') {
  const state = { ...initialRoomState, me: { ...initialRoomState.me, userId: 'me' } };
  return renderSocial(
    <SidebarProvider>
      <GroupDetailsPanel conversationId="g1" open onOpenChange={vi.fn()} onOpenProfile={vi.fn()} onOpenMedia={vi.fn()} onOpenSearch={vi.fn()} />
    </SidebarProvider>,
    { room: { state, conversations: [group(myRole)], allUsers: new Map([['u-ana', pub(ana)], ['me', { ...pub(ana), id: 'me', username: 'eu', displayName: 'Eu' }]]) } },
  );
}

describe('GroupDetailsPanel — invitations', () => {
  it('owner invites friends (who are not yet members) and does not add them directly', async () => {
    const user = userEvent.setup();
    mocked.inviteToGroup.mockResolvedValue({ results: [{ userId: 'u-bea', outcome: 'sent', invitationId: 'i' }] });
    setup('owner');

    await user.click(await screen.findByRole('button', { name: /Convidar amigos/ }));
    // Ana is already a member, so only Bea shows up as a candidate
    expect(await screen.findByRole('button', { name: /Bea/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ana/, pressed: false })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Bea/ }));
    await user.click(screen.getByRole('button', { name: 'Convidar (1)' }));
    expect(mocked.inviteToGroup).toHaveBeenCalledWith('g1', ['u-bea']);
    // the picker was a modal over the details: it closes, and the details say what happened
    expect(await screen.findByText('Convite enviado.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Convidar amigos' })).not.toBeInTheDocument());
  });

  it('the picker opens in its own modal, not over the member list', async () => {
    const user = userEvent.setup();
    setup('owner');
    await user.click(await screen.findByRole('button', { name: /Convidar amigos/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Convidar amigos' });
    expect(within(dialog).getByText(/só entram no grupo ao aceitar/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Convidar amigos' })).not.toBeInTheDocument());
    expect(mocked.inviteToGroup).not.toHaveBeenCalled();
  });

  it('lists pending invitations, hides those already invited, and revokes', async () => {
    const user = userEvent.setup();
    mocked.fetchGroupInvitations.mockResolvedValue({ items: [{ id: 'inv-9', at: '2026-01-01T00:00:00.000Z', invitee: bea }], nextCursor: null });
    mocked.revokeInvitation.mockResolvedValue({ invitation: {} as never });
    setup('owner');

    // Bea is already invited, so the picker has no one left to offer
    await user.click(await screen.findByRole('button', { name: /Convidar amigos/ }));
    await waitFor(() => expect(screen.getByText('Você não tem amigos para convidar.')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    // the invitations are their own tab, counted
    await user.click(await screen.findByRole('tab', { name: 'Convites enviados (1)' }));
    await user.click(screen.getByRole('button', { name: 'Revogar' }));
    expect(mocked.revokeInvitation).toHaveBeenCalledWith('inv-9');
  });

  it('an individual failure shows up with its reason', async () => {
    const user = userEvent.setup();
    mocked.inviteToGroup.mockResolvedValue({ results: [{ userId: 'u-bea', outcome: 'not_friends' }] });
    setup('owner');
    await user.click(await screen.findByRole('button', { name: /Convidar amigos/ }));
    await user.click(await screen.findByRole('button', { name: /Bea/ }));
    await user.click(screen.getByRole('button', { name: 'Convidar (1)' }));
    // the modal stays open to say who didn't get one, and why
    const dialog = await screen.findByRole('dialog', { name: 'Convidar amigos' });
    expect(await within(dialog).findByText(/não é mais seu amigo/)).toBeInTheDocument();
    expect(within(dialog).getByText('Bea')).toBeInTheDocument();
  });

  it('a regular member does not see invite or sent invitations (and nothing is fetched)', async () => {
    setup('member');
    await screen.findByText('Squad');
    expect(screen.queryByRole('button', { name: /Convidar amigos/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Convites enviados')).not.toBeInTheDocument();
    expect(mocked.fetchGroupInvitations).not.toHaveBeenCalled();
  });

  it('the member list is paginated from the server, with the owner marked', async () => {
    const user = userEvent.setup();
    mocked.fetchGroupMembers.mockResolvedValueOnce(memberPage('cursor-2')).mockResolvedValueOnce({
      items: [{ user: bea, role: 'member', at: '2026-01-03T00:00:00.000Z' }], nextCursor: null,
    });
    setup('owner');
    // the count is part of the overview, where the modal opens
    expect(await screen.findByText('2 membros')).toBeInTheDocument();

    // the owner carries a crown (named for a screen reader), not a badge with words
    expect(await screen.findByRole('img', { name: 'Dono' })).toBeInTheDocument();
    expect(screen.queryByText('dono')).not.toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: 'Dono' })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Carregar mais' }));
    expect(mocked.fetchGroupMembers).toHaveBeenLastCalledWith('g1', 'cursor-2');
    expect(await screen.findByText('Bea')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).not.toBeInTheDocument();
  });

  it('the camera opens the file picker straight away: a photo only ever comes from the computer', async () => {
    const user = userEvent.setup();
    setup('owner');
    const input = screen.getByLabelText('Selecionar foto do grupo') as HTMLInputElement;
    const picked = vi.spyOn(input, 'click');

    await user.click(await screen.findByRole('button', { name: 'Trocar foto do grupo' }));

    expect(picked).toHaveBeenCalled();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.queryByText('Usar URL')).not.toBeInTheDocument();
  });

  it('shows processing before switching to the group upload modal', async () => {
    const user = userEvent.setup();
    let finishUpload: (() => void) | undefined;
    let resolveUpload: ((value: { avatar: string }) => void) | undefined;
    uploadCroppedProfileImage.mockImplementation((
      _file: Blob,
      _crop: { x: number; y: number; width: number; height: number },
      _onProgress: ((fraction: number) => void) | undefined,
      onPhaseChange?: (phase: 'processing' | 'uploading') => void,
    ) => new Promise((resolve) => {
      resolveUpload = resolve;
      onPhaseChange?.('processing');
      finishUpload = () => {
        onPhaseChange?.('uploading');
      };
    }));
    setup('owner');

    await user.upload(screen.getByLabelText('Selecionar foto do grupo'), new File(['gif'], 'foto.gif', { type: 'image/gif' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar recorte' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Processando imagem…');
    expect(screen.queryByText('Enviando a foto do grupo…')).not.toBeInTheDocument();

    finishUpload?.();
    expect(await screen.findByText('Enviando a foto do grupo…')).toBeInTheDocument();
    resolveUpload?.({ avatar: '/uploads/group-avatar' });
  });

  it('owner sees transfer/remove on others; a regular member sees no management controls', async () => {
    const { unmount } = setup('owner');
    expect(await screen.findByRole('button', { name: 'Remover Ana' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Transferir propriedade para Ana' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remover Eu/ })).not.toBeInTheDocument();
    unmount();

    setup('member');
    await screen.findByText('Ana');
    expect(screen.queryByRole('button', { name: /Remover/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Transferir/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sair do grupo/ })).toBeInTheDocument();
  });

  it('an error loading members offers a retry', async () => {
    const user = userEvent.setup();
    mocked.fetchGroupMembers.mockRejectedValueOnce(new Error('x'));
    setup('member');
    await user.click(await screen.findByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText('Ana')).toBeInTheDocument();
  });

  it('any member can report the group', async () => {
    const user = userEvent.setup();
    setup('member');
    await user.click(await screen.findByRole('button', { name: /Denunciar grupo/ }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Denunciar grupo');
  });
});

describe('GroupDetailsPanel — the group card and its people, in one screen', () => {
  it('is a dialog with the group on the left and its members on the right, no side navigation', async () => {
    setup('owner');
    const dialog = await screen.findByRole('dialog', { name: 'Detalhes do grupo' });
    expect(dialog).toHaveTextContent('Squad');
    expect(screen.getByRole('tab', { name: 'Membros' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('Ana')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Seções do grupo' })).not.toBeInTheDocument();
  });

  it('the card says how big the group is, how many are online, since when, and whose it is', async () => {
    setup('owner');
    await screen.findByRole('dialog', { name: 'Detalhes do grupo' });
    expect(screen.getByText('2 membros')).toBeInTheDocument();
    // me (always) and Ana (not online): one
    expect(screen.getByText('1 online')).toBeInTheDocument();
    expect(screen.getByText('Criado em')).toBeInTheDocument();
    expect(screen.getByText('Dono')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Você/ })).toBeInTheDocument();
  });

  it('shortcuts open the media and the search, the group actions are once on the card', async () => {
    const onOpenMedia = vi.fn(); const onOpenSearch = vi.fn();
    const state = { ...initialRoomState, me: { ...initialRoomState.me, userId: 'me' } };
    renderSocial(
      <SidebarProvider>
        <GroupDetailsPanel conversationId="g1" open onOpenChange={vi.fn()} onOpenProfile={vi.fn()} onOpenMedia={onOpenMedia} onOpenSearch={onOpenSearch} />
      </SidebarProvider>,
      { room: { state, conversations: [group('owner')] } },
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Mídias e links' }));
    await user.click(screen.getByRole('button', { name: 'Buscar na conversa' }));
    expect(onOpenMedia).toHaveBeenCalledTimes(1);
    expect(onOpenSearch).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('button', { name: /Sair do grupo/ })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /Excluir grupo/ })).toHaveLength(1);
  });

  it('only the owner has the invitations tab and the invite shortcut', async () => {
    const { unmount } = setup('owner');
    expect(await screen.findByRole('tab', { name: /Convites enviados/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Convidar amigos' })).toBeInTheDocument();
    unmount();
    setup('member');
    await screen.findByRole('tab', { name: 'Membros' });
    expect(screen.queryByRole('tab', { name: /Convites enviados/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Convidar amigos' })).not.toBeInTheDocument();
  });

  it('an empty invitations tab says so', async () => {
    setup('owner');
    await userEvent.setup().click(await screen.findByRole('tab', { name: /Convites enviados/ }));
    expect(await screen.findByText('Nenhum convite pendente.')).toBeInTheDocument();
  });

  it('closes from the header button', async () => {
    const onOpenChange = vi.fn();
    const state = { ...initialRoomState, me: { ...initialRoomState.me, userId: 'me' } };
    renderSocial(
      <SidebarProvider>
        <GroupDetailsPanel conversationId="g1" open onOpenChange={onOpenChange} onOpenProfile={vi.fn()} onOpenMedia={vi.fn()} onOpenSearch={vi.fn()} />
      </SidebarProvider>,
      { room: { state, conversations: [group('member')] } },
    );
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Fechar' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
