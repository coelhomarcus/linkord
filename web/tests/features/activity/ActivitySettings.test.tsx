import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { ActivitySettings } from '@/features/activity/ActivitySettings';
import * as activityApi from '@/features/activity/activityApi';
import type { DesktopActivityApi, DesktopRunningActivities } from '@/shared/desktop';
import { initialRoomState } from '@/state/roomReducer';

vi.mock('@/features/activity/activityApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/activity/activityApi')>()),
  fetchOwnActivityHistory: vi.fn(),
}));
const fetchOwnHistory = vi.mocked(activityApi.fetchOwnActivityHistory);

beforeEach(() => { fetchOwnHistory.mockReset().mockResolvedValue({ items: [] }); });
afterEach(() => { delete window.linkordDesktop; });

function stubDesktop() {
  const api = {
    watch: vi.fn(async () => {}),
    current: vi.fn(async () => null),
    recent: vi.fn(async () => [{ key: 'minecraft', kind: 'playing' as const, name: 'Minecraft' }, { key: 'spotify', kind: 'using' as const, name: 'Spotify' }]),
    icon: vi.fn(async () => null),
    onChange: vi.fn(() => () => {}),
  } satisfies DesktopActivityApi;
  window.linkordDesktop = { platform: 'win32', version: '0.3.0', activity: api };
}

function stubChoosingDesktop(initial: DesktopRunningActivities) {
  let listener: ((running: DesktopRunningActivities) => void) | null = null;
  const api = {
    watch: vi.fn(async () => {}),
    current: vi.fn(async () => null),
    recent: vi.fn(async () => [{ key: 'minecraft', kind: 'playing' as const, name: 'Minecraft' }]),
    icon: vi.fn(async () => null),
    onChange: vi.fn(() => () => {}),
    running: vi.fn(async () => initial),
    prefer: vi.fn(async (key: string | null) => { listener?.({ ...initial, preferred: key }); }),
    setHidden: vi.fn(async () => {}),
    onRunningChange: vi.fn((callback: (running: DesktopRunningActivities) => void) => {
      listener = callback;
      return () => { listener = null; };
    }),
  } satisfies DesktopActivityApi;
  window.linkordDesktop = { platform: 'win32', version: '0.6.0', activity: api };
  return api;
}

const running: DesktopRunningActivities['running'] = [
  { key: 'minecraft', kind: 'playing', name: 'Minecraft' },
  { key: 'spotify', kind: 'using', name: 'Spotify' },
  { key: 'figma', kind: 'using', name: 'Figma' },
];

describe('ActivitySettings', () => {
  it('picks which running activity shows, or automatic', async () => {
    const api = stubChoosingDesktop({ running, preferred: null });
    renderWithRoom(<ActivitySettings />, { activitySettings: { sharing: true, hidden: ['figma'] } });
    const user = userEvent.setup();
    const select = await screen.findByRole('combobox', { name: 'Atividade exibida' });
    expect(select).toHaveTextContent('Automático');
    await user.click(select);
    // a hidden one is not offered
    expect(screen.queryByRole('option', { name: 'Figma' })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('option', { name: 'Spotify' }));
    expect(api.prefer).toHaveBeenLastCalledWith('spotify');
    expect(await screen.findByRole('combobox', { name: 'Atividade exibida' })).toHaveTextContent('Spotify');
    await user.click(screen.getByRole('combobox', { name: 'Atividade exibida' }));
    await user.click(await screen.findByRole('option', { name: 'Automático' }));
    expect(api.prefer).toHaveBeenLastCalledWith(null);
  });

  it('keeps showing the activity picked by hand while it is closed', async () => {
    stubChoosingDesktop({ running: running.slice(1), preferred: 'minecraft' });
    renderWithRoom(<ActivitySettings />, { activitySettings: { sharing: true, hidden: [] } });
    expect(await screen.findByRole('combobox', { name: 'Atividade exibida' })).toHaveTextContent('Minecraft (fechado)');
  });

  it('offers no choice while sharing is off, or in a desktop app that cannot choose', async () => {
    stubChoosingDesktop({ running, preferred: null });
    const { unmount } = renderWithRoom(<ActivitySettings />, { activitySettings: { sharing: false, hidden: [] } });
    expect(screen.queryByRole('combobox', { name: 'Atividade exibida' })).not.toBeInTheDocument();
    unmount();
    stubDesktop();
    renderWithRoom(<ActivitySettings />, { activitySettings: { sharing: true, hidden: [] } });
    expect(await screen.findByRole('button', { name: 'Ocultar Minecraft' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Atividade exibida' })).not.toBeInTheDocument();
  });

  it('splits the tab into sharing and the games list', () => {
    renderWithRoom(<ActivitySettings />, { activitySettings: { sharing: true, hidden: [] } });
    expect(screen.getByRole('region', { name: 'Compartilhamento' })).toContainElement(screen.getByRole('switch', { name: 'Compartilhar minha atividade' }));
    expect(screen.getByRole('region', { name: 'Jogos e apps' })).toHaveTextContent(/A detecção acontece no app desktop/);
  });

  it('turns sharing off', async () => {
    const updateActivitySettings = vi.fn(async () => {});
    renderWithRoom(<ActivitySettings />, { activitySettings: { sharing: true, hidden: [] }, updateActivitySettings });
    await userEvent.setup().click(screen.getByRole('switch', { name: 'Compartilhar minha atividade' }));
    expect(updateActivitySettings).toHaveBeenCalledWith({ sharing: false });
  });

  it('hides a game this computer found, and shows one hidden again', async () => {
    stubDesktop();
    const updateActivitySettings = vi.fn(async () => {});
    renderWithRoom(<ActivitySettings />, { activitySettings: { sharing: true, hidden: ['spotify'] }, updateActivitySettings });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Ocultar Minecraft' }));
    expect(updateActivitySettings).toHaveBeenLastCalledWith({ hidden: ['spotify', 'minecraft'] });
    await user.click(screen.getByRole('button', { name: 'Mostrar Spotify' }));
    expect(updateActivitySettings).toHaveBeenLastCalledWith({ hidden: [] });
  });

  it('shows each game and app with its icon, and the kind glyph for one without', async () => {
    stubDesktop();
    const obsIcon = `/api/activity/icons/${'b'.repeat(64)}.webp`;
    fetchOwnHistory.mockResolvedValue({
      items: [
        { key: 'spotify', kind: 'using', name: 'Spotify', icon: `/api/activity/icons/${'a'.repeat(64)}.webp`, lastPlayedAt: '2026-11-20T10:00:00Z' },
        { key: 'obs-studio', kind: 'using', name: 'OBS Studio', icon: obsIcon, lastPlayedAt: '2026-11-19T10:00:00Z' },
      ],
    });
    const { container } = renderWithRoom(<ActivitySettings />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, userId: 'me' } },
      activitySettings: { sharing: true, hidden: ['obs-studio'] },
    });
    const detected = await screen.findByRole('button', { name: 'Ocultar Spotify' });
    const spotifyRow = detected.parentElement!;
    await vi.waitFor(() => expect(spotifyRow.querySelector('img')).toHaveAttribute('src', `/api/activity/icons/${'a'.repeat(64)}.webp`));
    expect(spotifyRow).toHaveTextContent('App');
    // never seen on this computer, but hidden: named and drawn from the account's history
    const obsRow = screen.getByRole('button', { name: 'Mostrar OBS Studio' }).parentElement!;
    expect(obsRow.querySelector('img')).toHaveAttribute('src', obsIcon);
    const minecraftRow = screen.getByRole('button', { name: 'Ocultar Minecraft' }).parentElement!;
    expect(minecraftRow.querySelector('img')).toBeNull();
    expect(minecraftRow).toHaveTextContent('Jogo');
    expect(container.querySelectorAll('img')).toHaveLength(2);
  });

  it('says why hiding a game did not save, in the games section', async () => {
    stubDesktop();
    const updateActivitySettings = vi.fn(async () => { throw new Error('Não foi possível salvar. Tente de novo.'); });
    renderWithRoom(<ActivitySettings />, { activitySettings: { sharing: true, hidden: [] }, updateActivitySettings });
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Ocultar Minecraft' }));
    expect(await within(screen.getByRole('region', { name: 'Jogos e apps' })).findByText('Não foi possível salvar. Tente de novo.')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Compartilhamento' })).queryByText('Não foi possível salvar. Tente de novo.')).not.toBeInTheDocument();
  });

  it('says detection needs the desktop app, in a browser', () => {
    renderWithRoom(<ActivitySettings />, { activitySettings: { sharing: true, hidden: [] } });
    expect(screen.getByText(/A detecção acontece no app desktop/)).toBeInTheDocument();
  });

  it('says why a change did not save', async () => {
    const updateActivitySettings = vi.fn(async () => { throw new Error('Não foi possível salvar. Tente de novo.'); });
    renderWithRoom(<ActivitySettings />, { activitySettings: { sharing: true, hidden: [] }, updateActivitySettings });
    await userEvent.setup().click(screen.getByRole('switch', { name: 'Compartilhar minha atividade' }));
    expect(await screen.findByText('Não foi possível salvar. Tente de novo.')).toBeInTheDocument();
  });
});
