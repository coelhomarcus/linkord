import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { RouterProvider, createMemoryRouter, useLocation } from 'react-router';
import userEvent from '@testing-library/user-event';
import { initialRoomState } from '@/state/roomReducer';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import type { RoomContextValue } from '@/state/RoomContext';
import { SettingsPage } from '@/features/settings/SettingsPage';

vi.mock('@/features/profile/ConnectionsSettings', () => ({ ConnectionsSettings: () => <section>Conexões</section> }));

vi.mock('@/state/AuthContext', () => ({
  useAuth: () => ({ logout: vi.fn() }),
}));

// the page header needs the sidebar provider and the privacy tab
// needs the friends provider — neither is what these tests are about
vi.mock('@/shared/PageHeader', () => ({
  PageHeader: ({ title, leading }: { title: string; leading?: React.ReactNode }) => <header>{leading}<h1>{title}</h1></header>,
}));
vi.mock('@/features/settings/PrivacyTab', () => ({ PrivacyTab: () => <p>lista de bloqueados</p> }));

function renderSettings(overrides: Partial<RoomContextValue> = {}, path = '/app/settings/account', onOpenProfile = vi.fn()) {
  const router = createMemoryRouter(
    [{ path: '/app/settings/:tab?', element: <SettingsPage onOpenProfile={onOpenProfile} /> }],
    { initialEntries: [path] },
  );
  return { ...renderWithRoom(<RouterProvider router={router} />, overrides), router };
}

describe('SettingsPage — connections', () => {
  it('lists the connections on their own tab', () => {
    renderSettings({}, '/app/settings/connections');
    expect(screen.getByText('Conexões', { selector: 'section' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Conexões' })).toBeInTheDocument();
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

function renderRouted(overrides: Partial<RoomContextValue> = {}, path = '/app/settings/account') {
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
    expect(screen.getByRole('link', { name: 'Dados e privacidade' })).toHaveAttribute('aria-current', 'page');
  });

  it('keeps the sidebar one level deep: an open category lists no sections under it', () => {
    renderSettings({ state: userState }, '/app/settings/account');
    expect(screen.getByRole('link', { name: 'Minha conta' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('list', { name: /Seções de/ })).not.toBeInTheDocument();
  });

  it('with no category in the URL, wide mode shows the account at the same URL (no redirect)', () => {
    renderRouted({ state: userState }, '/app/settings');
    expect(screen.getByRole('heading', { level: 2, name: 'Minha conta' })).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/app/settings');
    expect(screen.getByRole('link', { name: 'Minha conta' })).toHaveAttribute('aria-current', 'page');
  });

  it('an unknown category, or the old profile one, falls back to the account instead of an empty page', () => {
    renderRouted({ state: userState }, '/app/settings/naoexiste');
    expect(screen.getByTestId('where')).toHaveTextContent('/app/settings/account');
    renderRouted({ state: userState }, '/app/settings/profile');
    expect(screen.getAllByTestId('where').at(-1)).toHaveTextContent('/app/settings/account');
  });

  it('the old Preferences tab lands on Appearance, where its first setting now lives', () => {
    renderRouted({ state: userState }, '/app/settings/prefs');
    expect(screen.getByTestId('where')).toHaveTextContent('/app/settings/appearance');
  });

  it('groups the categories like Discord: user settings, then app settings', () => {
    renderSettings({ state: userState });
    const nav = screen.getByRole('navigation', { name: 'Categorias de ajustes' });
    expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Minha conta', 'Conexões', 'Dados e privacidade', 'Aparência', 'Voz e vídeo', 'Chat', 'Notificações', 'Idioma e hora',
    ]);
    expect(within(nav).getByText('Configurações de usuário')).toBeInTheDocument();
    expect(within(nav).getByText('Configurações do app')).toBeInTheDocument();
  });

  it('administration does not appear for a non-admin (not even by URL)', () => {
    renderRouted({ state: userState }, '/app/settings/moderation');
    expect(screen.getByTestId('where')).toHaveTextContent('/app/settings/account');
    expect(screen.queryByRole('link', { name: 'Administração' })).not.toBeInTheDocument();
  });

  it('opens the list with who you are, and editing the profile opens your own profile', async () => {
    const onOpenProfile = vi.fn();
    renderSettings({ state: userState }, '/app/settings/account', onOpenProfile);
    const shortcut = within(screen.getByRole('navigation', { name: 'Categorias de ajustes' })).getByRole('button', { name: /Editar perfil/ });
    expect(shortcut).toHaveTextContent('Ana');
    expect(screen.queryByRole('link', { name: 'Perfil' })).not.toBeInTheDocument();
    await userEvent.setup().click(shortcut);
    expect(onOpenProfile).toHaveBeenCalledWith('u');
  });

  it('admin sees the administration category', () => {
    renderSettings({ state: adminState });
    expect(screen.getByRole('link', { name: 'Administração' })).toBeInTheDocument();
  });

  it('clicking a category navigates to its route', async () => {
    const user = userEvent.setup();
    renderRouted({ state: userState });
    await user.click(screen.getByRole('link', { name: 'Dados e privacidade' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/app/settings/privacy');
    expect(screen.getByText('lista de bloqueados')).toBeInTheDocument();
  });

  it('searching and picking a result navigates to the destination and moves focus there (not just scroll)', async () => {
    const user = userEvent.setup();
    renderRouted({ state: userState });
    await user.type(screen.getByLabelText('Buscar'), 'camera');
    await user.click(screen.getByText('Vídeo'));

    expect(screen.getByTestId('where')).toHaveTextContent('/app/settings/av');
    expect(document.activeElement?.id).toBe('video');
  });
});

describe('SettingsPage — compact mode (index and detail)', () => {
  const userState = { ...initialRoomState, me: { ...initialRoomState.me, id: 'c', userId: 'u', name: 'Ana', displayName: 'Ana' } };

  beforeEach(() => { mockMode = 'compact'; });
  afterEach(() => { mockMode = 'wide'; });

  it('a category opens directly by link, with an accessible way back to the index', async () => {
    const user = userEvent.setup();
    renderRouted({ state: userState }, '/app/settings/privacy');
    expect(screen.getByText('lista de bloqueados')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Categorias de ajustes' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Voltar às configurações' }));
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/app\/settings$/);
    expect(screen.getByRole('link', { name: 'Dados e privacidade' })).toBeInTheDocument();
  });

  it('from the index, opening a category and going back walks the history (does not push the index again)', async () => {
    const user = userEvent.setup();
    renderRouted({ state: userState }, '/app/settings');
    await user.click(screen.getByRole('link', { name: 'Dados e privacidade' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/app/settings/privacy');
    await user.click(screen.getByRole('button', { name: 'Voltar às configurações' }));
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/app\/settings$/);
    expect(screen.getByRole('navigation', { name: 'Categorias de ajustes' })).toBeInTheDocument();
  });
});
