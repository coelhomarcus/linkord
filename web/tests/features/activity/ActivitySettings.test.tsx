import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { ActivitySettings } from '@/features/activity/ActivitySettings';
import type { DesktopActivityApi } from '@/shared/desktop';

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

describe('ActivitySettings', () => {
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
