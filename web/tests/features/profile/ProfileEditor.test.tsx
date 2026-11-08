import { useMemo, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import userEvent from '@testing-library/user-event';
import { initialRoomState } from '@/state/roomReducer';
import { createFakeRoomContextValue, renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { RoomContext } from '@/state/RoomContext';
import type { RoomContextValue } from '@/state/RoomContext';
import { ProfileModal } from '@/features/profile/ProfileModal';
import { ProfileSaveRefused } from '@/features/profile/useProfileUpdate';
import type { PublicUser } from '@/shared/types/protocol';

vi.mock('@/features/profile/profileApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/profile/profileApi')>();
  return {
    ...actual,
    fetchWall: vi.fn(async () => ({ widgets: [], available: [] })),
    saveWall: vi.fn(async () => ({ widgets: [], available: [] })),
  };
});

vi.mock('@/shared/api/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/api/api')>();
  return {
    ...actual,
    fetchProfileDetails: vi.fn(async () => ({
      memberSince: '2025-05-05T00:00:00.000Z',
      friendsSince: null,
      mutualFriends: { items: [], total: 0 },
      mutualServers: { items: [], total: 0 },
    })),
  };
});

vi.mock('@/features/settings/ImageCropDialog', () => ({
  ImageCropDialog: ({ open, processing, onConfirm, onCancel }: { open: boolean; processing?: boolean; onConfirm: (crop: { x: number; y: number; width: number; height: number }) => void; onCancel: () => void }) =>
    open ? (
      <div>
        {processing && <p role="status">Processando imagem…</p>}
        <button type="button" disabled={processing} onClick={() => onConfirm({ x: 0, y: 0, width: 10, height: 10 })}>Confirmar recorte</button>
        <button type="button" disabled={processing} onClick={onCancel}>Cancelar recorte</button>
      </div>
    ) : null,
}));

type Me = RoomContextValue['state']['me'];

function publicUserOf(me: Me): PublicUser {
  return {
    id: me.userId!, username: me.name, displayName: me.displayName, avatar: me.avatar, avatarColor: me.avatarColor,
    banner: me.banner, bio: me.bio, profileLinks: me.profileLinks, role: me.role,
  };
}

/** Your own profile modal, which is where the profile is edited. */
function renderEditor(overrides: Partial<RoomContextValue> & { state: RoomContextValue['state'] }) {
  const onClose = vi.fn();
  const { me } = overrides.state;
  renderWithRoom(<MemoryRouter><ProfileModal userId={me.userId} onClose={onClose} onOpenProfile={vi.fn()} /></MemoryRouter>, {
    allUsers: new Map([[me.userId!, publicUserOf(me)]]),
    ...overrides,
  });
  return { onClose };
}

describe('ProfileEditor', () => {
  it('lays the editor out like the profile, with the wall and without the shared tab', async () => {
    renderEditor({ state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'c', userId: 'u', name: 'Fulana', displayName: 'Fulana', avatarColor: 'green' } } });
    expect(await screen.findByRole('tab', { name: 'Mural' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Seus Widgets' })).toBeInTheDocument();
    expect(await screen.findByText('Membro desde')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Adicionar conexão' })).toBeInTheDocument();
    expect(screen.queryByText('Atividade')).not.toBeInTheDocument();
    expect(screen.queryByText('Lista de desejos')).not.toBeInTheDocument();
    expect(screen.queryByText('Conexões', { selector: 'section' })).not.toBeInTheDocument();
  });

  it('brings the edited field back above the save bar when the bar appears', async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      renderEditor({ state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'c', userId: 'u', name: 'Fulana', displayName: 'Fulana', avatarColor: 'green' } } });
      const trigger = screen.getByRole('button', { name: 'Cor do perfil: Verde' });
      await user.click(trigger);
      await user.click(await screen.findByRole('button', { name: 'Usar Fuchsia' }));

      expect(screen.getByRole('region', { name: 'Salvar alterações do perfil' })).toBeInTheDocument();
      // the colour field in the profile, not the swatch inside the popover
      expect(scrollIntoView.mock.contexts).toContain(trigger);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it('saves the chosen color for the avatar background', async () => {
    const user = userEvent.setup();
    const updateProfile = vi.fn();
    const state = {
      ...initialRoomState,
      me: {
        ...initialRoomState.me,
        id: 'conn-1',
        userId: 'user-1',
        name: 'Fulana',
        displayName: 'Fulana',
        avatar: '',
        avatarColor: 'green',
      },
    };

    renderEditor({ state, updateProfile });

    await user.click(screen.getByRole('button', { name: 'Cor do perfil: Verde' }));
    await user.click(await screen.findByRole('button', { name: 'Usar Fuchsia' }));
    await user.click(screen.getByRole('button', { name: 'Salvar perfil' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Perfil salvo.');

    expect(updateProfile).toHaveBeenCalledWith({
      avatar: '',
      avatarPoster: '',
      avatarColor: 'fuchsia',
      displayName: 'Fulana',
      banner: '',
      bannerPoster: '',
      bio: '',
    });
  });

  it('saves a new display name, different from the username', async () => {
    const user = userEvent.setup();
    const updateProfile = vi.fn();
    const state = {
      ...initialRoomState,
      me: {
        ...initialRoomState.me,
        id: 'conn-1',
        userId: 'user-1',
        name: 'Fulana',
        displayName: 'Fulana',
        avatar: '',
        avatarColor: 'green',
      },
    };

    renderEditor({ state, updateProfile });

    const input = screen.getByLabelText('Nome de exibição');
    await user.clear(input);
    await user.type(input, 'Apelido Legal');
    await user.click(screen.getByRole('button', { name: 'Salvar perfil' }));

    expect(updateProfile).toHaveBeenCalledWith({
      avatar: '',
      avatarPoster: '',
      avatarColor: 'green',
      displayName: 'Apelido Legal',
      banner: '',
      bannerPoster: '',
      bio: '',
    });
  });

  it('saves a custom color (outside the presets) typed in the color picker', async () => {
    const user = userEvent.setup();
    const updateProfile = vi.fn();
    const state = {
      ...initialRoomState,
      me: {
        ...initialRoomState.me,
        id: 'conn-1',
        userId: 'user-1',
        name: 'Fulana',
        displayName: 'Fulana',
        avatar: '',
        avatarColor: 'green',
      },
    };

    renderEditor({ state, updateProfile });

    await user.click(screen.getByRole('button', { name: 'Cor do perfil: Verde' }));
    const hex = await screen.findByLabelText('Código hexadecimal da cor');
    await user.clear(hex);
    await user.type(hex, 'a1b2c3');
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Salvar perfil' }));

    expect(updateProfile).toHaveBeenCalledWith({
      avatar: '',
      avatarPoster: '',
      avatarColor: '#a1b2c3',
      displayName: 'Fulana',
      banner: '',
      bannerPoster: '',
      bio: '',
    });
  });

  it('saves bio independently from connections', async () => {
    const user = userEvent.setup();
    const updateProfile = vi.fn();
    const state = {
      ...initialRoomState,
      me: {
        ...initialRoomState.me,
        id: 'conn-1',
        userId: 'user-1',
        name: 'Fulana',
        displayName: 'Fulana',
        avatar: '',
        avatarColor: 'green',
      },
    };

    renderEditor({ state, updateProfile });

    await user.type(screen.getByLabelText('Bio'), 'Oi, eu sou a Fulana.');
    await user.click(screen.getByRole('button', { name: 'Salvar perfil' }));

    expect(updateProfile).toHaveBeenCalledWith({
      avatar: '',
      avatarPoster: '',
      avatarColor: 'green',
      displayName: 'Fulana',
      banner: '',
      bannerPoster: '',
      bio: 'Oi, eu sou a Fulana.',
    });
  });

  it('shows "Remover foto" only when a photo already exists', async () => {
    const user = userEvent.setup();
    const stateWithoutPhoto = {
      ...initialRoomState,
      me: { ...initialRoomState.me, id: 'conn-1', userId: 'user-1', name: 'Fulana', displayName: 'Fulana', avatar: '', avatarColor: 'green' },
    };
    renderEditor({ state: stateWithoutPhoto });

    await user.click(screen.getByRole('button', { name: 'Alterar foto de perfil' }));
    expect(await screen.findByRole('menuitem', { name: 'Enviar do computador' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Remover foto' })).not.toBeInTheDocument();
  });

  it('crops and uploads a new profile photo, without publishing the rest of the draft (isolated)', async () => {
    const user = userEvent.setup();
    const uploadProfileImage = vi.fn().mockResolvedValue('/uploads/novo-avatar');
    const state = {
      ...initialRoomState,
      me: { ...initialRoomState.me, id: 'conn-1', userId: 'user-1', name: 'Fulana', displayName: 'Fulana', avatar: '', avatarColor: 'green' },
    };
    renderEditor({ state, uploadProfileImage });

    const file = new File(['conteudo'], 'foto.png', { type: 'image/png' });
    await user.upload(screen.getByLabelText('Selecionar foto de perfil'), file);
    await user.click(screen.getByRole('button', { name: 'Confirmar recorte' }));

    // The only extra argument is the phase callback — an avatar upload can
    // never carry whatever is currently typed into the profile form.
    expect(uploadProfileImage).toHaveBeenCalledWith('avatar', file, { x: 0, y: 0, width: 10, height: 10 }, expect.any(Function), expect.any(Function));
    expect(uploadProfileImage).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), expect.anything(), expect.anything(), expect.anything());
  });

  it('shows processing before switching to the upload progress modal', async () => {
    const user = userEvent.setup();
    let finishUpload: (() => void) | undefined;
    let resolveUpload: ((value: string) => void) | undefined;
    const uploadProfileImage = vi.fn((
      _field: string,
      _file: Blob,
      _crop: { x: number; y: number; width: number; height: number },
      _onProgress: ((fraction: number) => void) | undefined,
      onPhaseChange?: (phase: 'processing' | 'uploading') => void,
    ) => new Promise<string>((resolve) => {
      resolveUpload = resolve;
      onPhaseChange?.('processing');
      finishUpload = () => {
        onPhaseChange?.('uploading');
      };
    }));
    const state = {
      ...initialRoomState,
      me: { ...initialRoomState.me, id: 'conn-1', userId: 'user-1', name: 'Fulana', displayName: 'Fulana', avatar: '', avatarColor: 'green' },
    };
    renderEditor({ state, uploadProfileImage });

    await user.upload(screen.getByLabelText('Selecionar foto de perfil'), new File(['conteudo'], 'foto.gif', { type: 'image/gif' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar recorte' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Processando imagem…');
    expect(screen.queryByText('Enviando a foto de perfil…')).not.toBeInTheDocument();

    finishUpload?.();
    expect(await screen.findByText('Enviando a foto de perfil…')).toBeInTheDocument();
    resolveUpload?.('/uploads/novo-avatar');
  });

  it('the photo menu offers only a file from the computer, never a URL', async () => {
    const user = userEvent.setup();
    const state = {
      ...initialRoomState,
      me: { ...initialRoomState.me, id: 'conn-1', userId: 'user-1', name: 'Fulana', displayName: 'Fulana', avatar: '', avatarColor: 'green' },
    };
    renderEditor({ state });

    await user.click(screen.getByRole('button', { name: 'Alterar foto de perfil' }));
    expect(await screen.findByRole('menuitem', { name: 'Enviar do computador' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Usar URL' })).not.toBeInTheDocument();
  });

  it('removes the profile photo via an isolated request (not through the form\'s updateProfile)', async () => {
    const user = userEvent.setup();
    const removeProfileImage = vi.fn().mockResolvedValue({});
    const updateProfile = vi.fn();
    const state = {
      ...initialRoomState,
      me: { ...initialRoomState.me, id: 'conn-1', userId: 'user-1', name: 'Fulana', displayName: 'Fulana', avatar: '/uploads/foto-atual', avatarColor: 'green' },
    };
    renderEditor({ state, updateProfile, removeProfileImage });

    await user.click(screen.getByRole('button', { name: 'Alterar foto de perfil' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Remover foto' }));

    expect(removeProfileImage).toHaveBeenCalledWith('avatar');
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it('error on save shows the reason and does not lock the form', async () => {
    const user = userEvent.setup();
    const updateProfile = vi.fn().mockRejectedValue(new ProfileSaveRefused('rate_limited', 'Você está enviando rápido demais.'));
    const state = { ...initialRoomState, me: { ...initialRoomState.me, id: 'conn-1', userId: 'user-1', name: 'Fulana', displayName: 'Fulana' } };
    renderEditor({ state, updateProfile });

    await user.type(screen.getByLabelText('Bio'), 'edição pendente');
    await user.click(screen.getByRole('button', { name: 'Salvar perfil' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Você está enviando rápido demais.');
    expect(screen.queryByText('Perfil salvo.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salvar perfil' })).toBeEnabled();
  });

  it('does not show the conflict banner after a successful save updates state.me', async () => {
    const user = userEvent.setup();
    const baseMe = {
      ...initialRoomState.me,
      id: 'conn-1',
      userId: 'user-1',
      name: 'Fulana',
      displayName: 'Fulana',
      avatar: '',
      avatarColor: 'green',
      bio: '',
      profileLinks: [] as string[],
    };

    function Harness() {
      const [me, setMe] = useState(baseMe);
      const room = useMemo(() => {
        const updateProfile = async (profile: {
          avatar: string; avatarPoster: string; avatarColor: string; displayName: string;
          banner: string; bannerPoster: string; bio: string;
        }) => {
          let next = baseMe;
          setMe((prev) => {
            next = {
              ...prev,
              displayName: profile.displayName,
              avatarColor: profile.avatarColor,
              bio: profile.bio,
            };
            return next;
          });
          return {
            displayName: profile.displayName,
            avatarColor: profile.avatarColor,
            bio: profile.bio,
          };
        };
        return createFakeRoomContextValue({ state: { ...initialRoomState, me }, updateProfile, allUsers: new Map([[me.userId, publicUserOf(me)]]) });
      }, [me]);
      return (
        <RoomContext.Provider value={room}>
          <MemoryRouter><ProfileModal userId={baseMe.userId} onClose={vi.fn()} onOpenProfile={vi.fn()} /></MemoryRouter>
        </RoomContext.Provider>
      );
    }

    render(<Harness />);
    await user.type(screen.getByLabelText('Bio'), 'Bio nova');
    await user.click(screen.getByRole('button', { name: 'Salvar perfil' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Perfil salvo.');
    expect(screen.queryByText('Usar valores salvos')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Salvar perfil' })).not.toBeInTheDocument();
  });

  it('discarding reverts fields to the last confirmed values and hides the bar', async () => {
    const user = userEvent.setup();
    const state = {
      ...initialRoomState,
      me: { ...initialRoomState.me, id: 'conn-1', userId: 'user-1', name: 'Fulana', displayName: 'Fulana', bio: 'bio original' },
    };
    renderEditor({ state });

    const bio = screen.getByLabelText('Bio');
    await user.type(bio, ' e mais um pedaço');
    await user.click(screen.getByRole('button', { name: 'Descartar' }));

    expect(bio).toHaveValue('bio original');
    expect(screen.queryByRole('button', { name: 'Salvar perfil' })).not.toBeInTheDocument();
  });
});

describe('ProfileEditor — closing with a pending draft', () => {
  const userState = { ...initialRoomState, me: { ...initialRoomState.me, id: 'conn-1', userId: 'user-1', name: 'Fulana', displayName: 'Fulana', bio: 'bio original' } };

  it('closing with a dirty draft opens the dialog; continuing to edit keeps the draft', async () => {
    const user = userEvent.setup();
    const { onClose } = renderEditor({ state: userState });
    await user.type(screen.getByLabelText('Bio'), ' e mais');
    await user.keyboard('{Escape}');

    expect(await screen.findByText('Alterações não salvas')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continuar editando' }));
    expect(screen.queryByText('Alterações não salvas')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Bio')).toHaveValue('bio original e mais');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('discard and leave throws away the draft and closes the profile', async () => {
    const user = userEvent.setup();
    const updateProfile = vi.fn();
    const { onClose } = renderEditor({ state: userState, updateProfile });
    await user.type(screen.getByLabelText('Bio'), ' e mais');
    await user.keyboard('{Escape}');
    await screen.findByText('Alterações não salvas');

    await user.click(screen.getByRole('button', { name: 'Descartar e sair' }));
    expect(onClose).toHaveBeenCalled();
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it('a link out of the editor asks first too, and goes once answered', async () => {
    const user = userEvent.setup();
    const { onClose } = renderEditor({ state: userState });
    await user.type(screen.getByLabelText('Bio'), ' e mais');
    await user.click(screen.getByRole('button', { name: 'Adicionar conexão' }));
    await screen.findByText('Alterações não salvas');
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Descartar e sair' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('save and leave only closes after confirming; an error keeps the dialog open', async () => {
    const user = userEvent.setup();
    const updateProfile = vi.fn().mockRejectedValue(new ProfileSaveRefused('rate_limited', 'Você está enviando rápido demais.'));
    const { onClose } = renderEditor({ state: userState, updateProfile });
    await user.type(screen.getByLabelText('Bio'), ' e mais');
    await user.keyboard('{Escape}');
    await screen.findByText('Alterações não salvas');

    await user.click(screen.getByRole('button', { name: 'Salvar e sair' }));
    const dialog = screen.getByRole('dialog', { name: 'Alterações não salvas' });
    expect(await within(dialog).findByText('Você está enviando rápido demais.')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('save and leave closes once the save is confirmed', async () => {
    const user = userEvent.setup();
    const updateProfile = vi.fn().mockResolvedValue(undefined);
    const { onClose } = renderEditor({ state: userState, updateProfile });
    await user.type(screen.getByLabelText('Bio'), ' e mais');
    await user.keyboard('{Escape}');
    await user.click(await screen.findByRole('button', { name: 'Salvar e sair' }));
    expect(updateProfile).toHaveBeenCalledWith(expect.objectContaining({ bio: 'bio original e mais' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('with no dirty draft, closing is instant, with no dialog', async () => {
    const user = userEvent.setup();
    const { onClose } = renderEditor({ state: userState });
    await screen.findByLabelText('Bio');
    await user.keyboard('{Escape}');
    expect(screen.queryByText('Alterações não salvas')).not.toBeInTheDocument();
    expect(onClose).toHaveBeenCalled();
  });
});
