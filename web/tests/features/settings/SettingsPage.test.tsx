import { useMemo, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { RouterProvider, createMemoryRouter, useLocation } from 'react-router';
import userEvent from '@testing-library/user-event';
import { initialRoomState } from '@/state/roomReducer';
import { createFakeRoomContextValue, renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { RoomContext } from '@/state/RoomContext';
import type { RoomContextValue } from '@/state/RoomContext';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { ProfileSaveRefused } from '@/features/profile/useProfileUpdate';

vi.mock('@/state/AuthContext', () => ({
  useAuth: () => ({ logout: vi.fn() }),
}));

// the page header needs the sidebar provider and the privacy tab
// needs the friends provider — neither is what these tests are about
vi.mock('@/shared/PageHeader', () => ({
  PageHeader: ({ title, leading }: { title: string; leading?: React.ReactNode }) => <header>{leading}<h1>{title}</h1></header>,
}));
vi.mock('@/features/settings/PrivacyTab', () => ({ PrivacyTab: () => <p>lista de bloqueados</p> }));

// A real (memory) data router, not just MemoryRouter/<Routes> — ProfileSettings
// calls useBlocker for the unsaved-changes guard, which only works with one.
function renderSettings(overrides: Partial<RoomContextValue> = {}, path = '/app/settings/profile') {
  const router = createMemoryRouter(
    [{ path: '/app/settings/:tab?', element: <SettingsPage onOpenProfile={vi.fn()} /> }],
    { initialEntries: [path] },
  );
  return { ...renderWithRoom(<RouterProvider router={router} />, overrides), router };
}

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

describe('SettingsPage — profile', () => {
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

    renderSettings({ state, updateProfile });

    await user.click(screen.getByRole('button', { name: 'Usar Fuchsia' }));
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
      profileLinks: [],
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

    renderSettings({ state, updateProfile });

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
      profileLinks: [],
    });
  });

  it('saves a custom color (outside the presets) chosen in the color picker', async () => {
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

    renderSettings({ state, updateProfile });

    fireEvent.change(screen.getByLabelText('Escolher cor personalizada'), { target: { value: '#a1b2c3' } });
    await user.click(screen.getByRole('button', { name: 'Salvar perfil' }));

    expect(updateProfile).toHaveBeenCalledWith({
      avatar: '',
      avatarPoster: '',
      avatarColor: '#a1b2c3',
      displayName: 'Fulana',
      banner: '',
      bannerPoster: '',
      bio: '',
      profileLinks: [],
    });
  });

  it('saves bio and profile links without empty lines', async () => {
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

    renderSettings({ state, updateProfile });

    await user.type(screen.getByLabelText('Bio'), 'Oi, eu sou a Fulana.');
    await user.type(screen.getByLabelText('Link 1'), 'https://youtube.com/@fulana');
    await user.click(screen.getByRole('button', { name: 'Adicionar link' }));
    await user.click(screen.getByRole('button', { name: 'Salvar perfil' }));

    expect(updateProfile).toHaveBeenCalledWith({
      avatar: '',
      avatarPoster: '',
      avatarColor: 'green',
      displayName: 'Fulana',
      banner: '',
      bannerPoster: '',
      bio: 'Oi, eu sou a Fulana.',
      profileLinks: ['https://youtube.com/@fulana'],
    });
  });

  it('shows "Remover foto" only when a photo already exists', async () => {
    const user = userEvent.setup();
    const stateWithoutPhoto = {
      ...initialRoomState,
      me: { ...initialRoomState.me, id: 'conn-1', userId: 'user-1', name: 'Fulana', displayName: 'Fulana', avatar: '', avatarColor: 'green' },
    };
    renderSettings({ state: stateWithoutPhoto });

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
    renderSettings({ state, uploadProfileImage });

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
    renderSettings({ state, uploadProfileImage });

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
    renderSettings({ state });

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
    renderSettings({ state, updateProfile, removeProfileImage });

    await user.click(screen.getByRole('button', { name: 'Alterar foto de perfil' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Remover foto' }));

    expect(removeProfileImage).toHaveBeenCalledWith('avatar');
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it('error on save shows the reason and does not lock the form', async () => {
    const user = userEvent.setup();
    const updateProfile = vi.fn().mockRejectedValue(new ProfileSaveRefused('rate_limited', 'Você está enviando rápido demais.'));
    const state = { ...initialRoomState, me: { ...initialRoomState.me, id: 'conn-1', userId: 'user-1', name: 'Fulana', displayName: 'Fulana' } };
    renderSettings({ state, updateProfile });

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
          banner: string; bannerPoster: string; bio: string; profileLinks: string[];
        }) => {
          let next = baseMe;
          setMe((prev) => {
            next = {
              ...prev,
              displayName: profile.displayName,
              avatarColor: profile.avatarColor,
              bio: profile.bio,
              profileLinks: profile.profileLinks,
            };
            return next;
          });
          return {
            displayName: profile.displayName,
            avatarColor: profile.avatarColor,
            bio: profile.bio,
            profileLinks: profile.profileLinks,
          };
        };
        return createFakeRoomContextValue({ state: { ...initialRoomState, me }, updateProfile });
      }, [me]);
      const router = createMemoryRouter(
        [{ path: '/app/settings/:tab?', element: <SettingsPage onOpenProfile={vi.fn()} /> }],
        { initialEntries: ['/app/settings/profile'] },
      );
      return (
        <RoomContext.Provider value={room}>
          <RouterProvider router={router} />
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

  it('with no edits, the save bar stays hidden', () => {
    const state = { ...initialRoomState, me: { ...initialRoomState.me, id: 'conn-1', userId: 'user-1', name: 'Fulana', displayName: 'Fulana' } };
    renderSettings({ state });
    expect(screen.queryByRole('button', { name: 'Salvar perfil' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Descartar' })).not.toBeInTheDocument();
  });

  it('with an active call, the save bar moves up to stay clear of the floating PiP', async () => {
    const user = userEvent.setup();
    const state = { ...initialRoomState, me: { ...initialRoomState.me, id: 'conn-1', userId: 'user-1', name: 'Fulana', displayName: 'Fulana' } };
    renderSettings({ state, activeCallConversationId: 'conv-1' });

    await user.type(screen.getByLabelText('Bio'), 'editando durante a chamada');
    const bar = screen.getByRole('region', { name: 'Salvar alterações do perfil' });
    // FloatingPip sits fixed at the viewport's bottom-left — lift the save pill so it stays tappable.
    expect(bar.className).toContain('bottom-20');
  });

  it('with no active call, the save bar floats above the bottom inset', async () => {
    const user = userEvent.setup();
    const state = { ...initialRoomState, me: { ...initialRoomState.me, id: 'conn-1', userId: 'user-1', name: 'Fulana', displayName: 'Fulana' } };
    renderSettings({ state, activeCallConversationId: null });

    await user.type(screen.getByLabelText('Bio'), 'editando sem chamada');
    const bar = screen.getByRole('region', { name: 'Salvar alterações do perfil' });
    expect(bar.className).toContain('fixed');
    expect(bar.className).toContain('bottom-[max(1rem,env(safe-area-inset-bottom))]');
    expect(bar.className).not.toContain('bottom-20');
  });

  it('discarding reverts fields to the last confirmed values and hides the bar', async () => {
    const user = userEvent.setup();
    const state = {
      ...initialRoomState,
      me: { ...initialRoomState.me, id: 'conn-1', userId: 'user-1', name: 'Fulana', displayName: 'Fulana', bio: 'bio original' },
    };
    renderSettings({ state });

    const bio = screen.getByLabelText('Bio');
    await user.type(bio, ' e mais um pedaço');
    await user.click(screen.getByRole('button', { name: 'Descartar' }));

    expect(bio).toHaveValue('bio original');
    expect(screen.queryByRole('button', { name: 'Salvar perfil' })).not.toBeInTheDocument();
  });
});

let mockMode: 'wide' | 'compact' = 'wide';
vi.mock('@/features/settings/useSettingsLayout', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/settings/useSettingsLayout')>()),
  useSettingsLayout: () => mockMode,
}));

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname}</p>;
}

function renderRouted(overrides: Partial<RoomContextValue> = {}, path = '/app/settings/profile') {
  const router = createMemoryRouter(
    [{ path: '/app/settings/:tab?', element: <><Where /><SettingsPage onOpenProfile={vi.fn()} /></> }],
    { initialEntries: [path] },
  );
  return { ...renderWithRoom(<RouterProvider router={router} />, overrides), router };
}

describe('SettingsPage — category navigation', () => {
  const adminState = { ...initialRoomState, me: { ...initialRoomState.me, id: 'c', userId: 'u', name: 'Ana', displayName: 'Ana', role: 'admin' as const } };
  const userState = { ...initialRoomState, me: { ...initialRoomState.me, id: 'c', userId: 'u', name: 'Ana', displayName: 'Ana' } };

  beforeEach(() => { mockMode = 'wide'; });

  it('opens the category named in the URL and marks it as the current page', () => {
    renderSettings({ state: userState }, '/app/settings/privacy');
    expect(screen.getByText('lista de bloqueados')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Privacidade' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Perfil' })).not.toHaveAttribute('aria-current');
  });

  it('with no category in the URL, wide mode shows Profile at the same URL (no redirect)', () => {
    renderRouted({ state: userState }, '/app/settings');
    expect(screen.getByLabelText('Nome de exibição')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/app/settings');
    expect(screen.getByRole('link', { name: 'Perfil' })).toHaveAttribute('aria-current', 'page');
  });

  it('unknown category falls back to profile instead of rendering an empty page', () => {
    renderRouted({ state: userState }, '/app/settings/naoexiste');
    expect(screen.getByLabelText('Nome de exibição')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/app/settings/profile');
  });

  it('administration does not appear for a non-admin (not even by URL)', () => {
    renderRouted({ state: userState }, '/app/settings/moderation');
    expect(screen.getByTestId('where')).toHaveTextContent('/app/settings/profile');
    expect(screen.queryByRole('link', { name: 'Administração' })).not.toBeInTheDocument();
  });

  it('admin sees the administration category', () => {
    renderSettings({ state: adminState });
    expect(screen.getByRole('link', { name: 'Administração' })).toBeInTheDocument();
  });

  it('clicking a category navigates to its route', async () => {
    const user = userEvent.setup();
    renderRouted({ state: userState });
    await user.click(screen.getByRole('link', { name: 'Privacidade' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/app/settings/privacy');
    expect(screen.getByText('lista de bloqueados')).toBeInTheDocument();
  });

  it('searching and picking a result navigates to the destination and moves focus there (not just scroll)', async () => {
    const user = userEvent.setup();
    renderRouted({ state: userState });
    await user.type(screen.getByLabelText('Buscar nas configurações'), 'camera');
    await user.click(screen.getByText('Câmera'));

    expect(screen.getByTestId('where')).toHaveTextContent('/app/settings/av');
    expect(document.activeElement?.id).toBe('camera');
  });

  it('search with no results shows the empty state, with a clear button', async () => {
    const user = userEvent.setup();
    renderRouted({ state: userState });
    await user.type(screen.getByLabelText('Buscar nas configurações'), 'xyzxyzxyz');
    expect(screen.getByText(/Nada encontrado/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Limpar busca' }));
    expect(screen.getByLabelText('Buscar nas configurações')).toHaveValue('');
    expect(screen.getByRole('link', { name: 'Privacidade' })).toBeInTheDocument();
  });

  it('the save button sits with the card, in the same form, without a side panel', async () => {
    const user = userEvent.setup();
    renderSettings({ state: userState });
    await user.type(screen.getByLabelText('Bio'), 'edição pendente');
    const form = screen.getByRole('button', { name: 'Salvar perfil' }).closest('form');
    expect(form).not.toBeNull();
    expect(form!.contains(screen.getByLabelText('Nome de exibição'))).toBe(true);
    expect(screen.queryByText('Salvar alterações')).not.toBeInTheDocument();
  });

  it.each([
    ['account', 'Minha conta'], ['av', 'Áudio e vídeo'], ['notifications', 'Notificações'], ['prefs', 'Preferências'], ['privacy', 'Privacidade'],
  ])('category %s opens with its own title', (tab, title) => {
    renderSettings({ state: userState }, `/app/settings/${tab}`);
    expect(screen.getByRole('heading', { level: 2, name: title })).toBeInTheDocument();
  });

  it('"Minha conta" lists sections in sequence (no card grid)', () => {
    renderSettings({ state: userState }, '/app/settings/account');
    for (const name of ['Identificação', 'E-mail', 'Armazenamento de anexos', 'Sessão']) {
      expect(screen.getByRole('heading', { level: 3, name })).toBeInTheDocument();
    }
  });
});

describe('SettingsPage — compact mode (index and detail)', () => {
  const userState = { ...initialRoomState, me: { ...initialRoomState.me, id: 'c', userId: 'u', name: 'Ana', displayName: 'Ana' } };

  beforeEach(() => { mockMode = 'compact'; });
  afterEach(() => { mockMode = 'wide'; });

  it('/app/settings shows the category index, without a form', () => {
    renderRouted({ state: userState }, '/app/settings');
    expect(screen.getByRole('navigation', { name: 'Categorias de ajustes' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Áudio e vídeo' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Nome de exibição')).not.toBeInTheDocument();
  });

  it('a category opens directly by link, with an accessible way back to the index', async () => {
    const user = userEvent.setup();
    renderRouted({ state: userState }, '/app/settings/privacy');
    expect(screen.getByText('lista de bloqueados')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Categorias de ajustes' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Voltar às configurações' }));
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/app\/settings$/);
    expect(screen.getByRole('link', { name: 'Privacidade' })).toBeInTheDocument();
  });

  it('from the index, opening a category and going back walks the history (does not push the index again)', async () => {
    const user = userEvent.setup();
    renderRouted({ state: userState }, '/app/settings');
    await user.click(screen.getByRole('link', { name: 'Privacidade' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/app/settings/privacy');
    await user.click(screen.getByRole('button', { name: 'Voltar às configurações' }));
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/app\/settings$/);
    expect(screen.getByRole('navigation', { name: 'Categorias de ajustes' })).toBeInTheDocument();
  });

  it('the index does not list administration for a non-admin', () => {
    renderRouted({ state: userState }, '/app/settings');
    expect(screen.queryByRole('link', { name: 'Administração' })).not.toBeInTheDocument();
  });
});

describe('SettingsPage — navigation block with a pending profile draft', () => {
  const userState = { ...initialRoomState, me: { ...initialRoomState.me, id: 'conn-1', userId: 'user-1', name: 'Fulana', displayName: 'Fulana', bio: 'bio original' } };

  beforeEach(() => { mockMode = 'wide'; });
  afterEach(() => { mockMode = 'wide'; });

  it('switching category with a dirty draft opens the dialog; continuing to edit keeps the draft', async () => {
    const user = userEvent.setup();
    renderSettings({ state: userState });
    await user.type(screen.getByLabelText('Bio'), ' e mais');
    await user.click(screen.getByRole('link', { name: 'Minha conta' }));

    expect(await screen.findByText('Alterações não salvas')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continuar editando' }));
    expect(screen.queryByText('Alterações não salvas')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Bio')).toHaveValue('bio original e mais');
  });

  it('discard and leave throws away the draft and completes the navigation', async () => {
    const user = userEvent.setup();
    renderSettings({ state: userState });
    await user.type(screen.getByLabelText('Bio'), ' e mais');
    await user.click(screen.getByRole('link', { name: 'Minha conta' }));
    await screen.findByText('Alterações não salvas');

    await user.click(screen.getByRole('button', { name: 'Descartar e sair' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Minha conta' })).toBeInTheDocument();
  });

  it('save and leave only navigates after confirming; an error keeps the dialog open on the same page', async () => {
    const user = userEvent.setup();
    const updateProfile = vi.fn().mockRejectedValue(new ProfileSaveRefused('rate_limited', 'Você está enviando rápido demais.'));
    renderSettings({ state: userState, updateProfile });
    await user.type(screen.getByLabelText('Bio'), ' e mais');
    await user.click(screen.getByRole('link', { name: 'Minha conta' }));
    await screen.findByText('Alterações não salvas');

    await user.click(screen.getByRole('button', { name: 'Salvar e sair' }));
    const dialog = screen.getByRole('dialog');
    expect(await within(dialog).findByText('Você está enviando rápido demais.')).toBeInTheDocument();
    expect(screen.getByText('Alterações não salvas')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: 'Minha conta' })).not.toBeInTheDocument();
  });

  it('with no dirty draft, switching category is instant, with no dialog', async () => {
    const user = userEvent.setup();
    renderSettings({ state: userState });
    await user.click(screen.getByRole('link', { name: 'Minha conta' }));
    expect(screen.queryByText('Alterações não salvas')).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 2, name: 'Minha conta' })).toBeInTheDocument();
  });
});
