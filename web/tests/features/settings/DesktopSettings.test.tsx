import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DesktopSettings } from '@/features/settings/DesktopSettings';
import type { DesktopSettingsApi, DesktopSettingsSnapshot } from '@/shared/desktop';

function snapshot(overrides: Partial<DesktopSettingsSnapshot> = {}): DesktopSettingsSnapshot {
  return {
    version: '0.3.0',
    startAtLogin: { available: true, enabled: false },
    closeToTray: true,
    startMinimized: true,
    update: { mode: 'install', status: { kind: 'idle' } },
    ...overrides,
  };
}

function stubSettings(initial: DesktopSettingsSnapshot, platform = 'win32') {
  let current = initial;
  let listener: ((settings: DesktopSettingsSnapshot) => void) | null = null;
  const api = {
    get: vi.fn(async () => current),
    set: vi.fn(async (change: Parameters<DesktopSettingsApi['set']>[0]) => {
      current = {
        ...current,
        ...('closeToTray' in change ? { closeToTray: !!change.closeToTray } : {}),
        ...('startMinimized' in change ? { startMinimized: !!change.startMinimized } : {}),
        ...('startAtLogin' in change ? { startAtLogin: { available: true, enabled: !!change.startAtLogin } } : {}),
      };
      return current;
    }),
    checkForUpdates: vi.fn(async () => ({ kind: 'up-to-date' as const })),
    applyUpdate: vi.fn(async () => {}),
    onChange: vi.fn((callback: (settings: DesktopSettingsSnapshot) => void) => {
      listener = callback;
      return () => { listener = null; };
    }),
  } satisfies DesktopSettingsApi;
  window.linkordDesktop = { platform, version: initial.version, settings: api };
  return { api, push: (next: DesktopSettingsSnapshot) => act(() => listener?.(next)) };
}

afterEach(() => { delete window.linkordDesktop; });

describe('DesktopSettings', () => {
  it('turns start with the computer on, which unlocks starting minimised', async () => {
    const { api } = stubSettings(snapshot());
    const user = userEvent.setup();
    render(<DesktopSettings />);
    const minimized = await screen.findByRole('switch', { name: 'Iniciar minimizado' });
    expect(minimized).toHaveAttribute('data-disabled');

    await user.click(screen.getByRole('switch', { name: 'Iniciar com o computador' }));

    expect(api.set).toHaveBeenCalledWith({ startAtLogin: true });
    expect(await screen.findByRole('switch', { name: 'Iniciar com o computador' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Iniciar minimizado' })).not.toHaveAttribute('data-disabled');
  });

  it('turns closing to the tray off, and follows a change made from the tray', async () => {
    const { api, push } = stubSettings(snapshot());
    const user = userEvent.setup();
    render(<DesktopSettings />);
    await user.click(await screen.findByRole('switch', { name: 'Manter aberto ao fechar a janela' }));
    expect(api.set).toHaveBeenCalledWith({ closeToTray: false });

    push(snapshot({ startAtLogin: { available: true, enabled: true } }));
    expect(screen.getByRole('switch', { name: 'Iniciar com o computador' })).toBeChecked();
  });

  it('names the tray after the system', async () => {
    stubSettings(snapshot(), 'darwin');
    render(<DesktopSettings />);
    expect(await screen.findByText(/continua na barra de menus/)).toBeInTheDocument();
  });

  it('leaves start with the computer out where the app cannot offer it', async () => {
    stubSettings(snapshot({ startAtLogin: { available: false, enabled: false } }));
    render(<DesktopSettings />);
    await screen.findByText('Versão 0.3.0');
    expect(screen.queryByRole('switch', { name: 'Iniciar com o computador' })).not.toBeInTheDocument();
  });

  it('checks for updates and says what it found', async () => {
    const { api } = stubSettings(snapshot());
    const user = userEvent.setup();
    render(<DesktopSettings />);
    await user.click(await screen.findByRole('button', { name: 'Procurar atualizações' }));
    expect(api.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Você está na versão mais recente.')).toBeInTheDocument();
  });

  it('offers the restart once an update is downloaded, and the download page on macOS', async () => {
    const { api } = stubSettings(snapshot({ update: { mode: 'install', status: { kind: 'downloaded', version: '0.4.0' } } }));
    const user = userEvent.setup();
    const { unmount } = render(<DesktopSettings />);
    await user.click(await screen.findByRole('button', { name: 'Reiniciar e atualizar' }));
    expect(api.applyUpdate).toHaveBeenCalledTimes(1);
    unmount();

    stubSettings(snapshot({ update: { mode: 'notify', status: { kind: 'available', version: '0.4.0', url: 'https://github.com/o/r/releases/tag/v0.4.0' } } }), 'darwin');
    render(<DesktopSettings />);
    expect(await screen.findByRole('button', { name: 'Baixar a versão 0.4.0' })).toBeInTheDocument();
  });

  it('says a build that does not check for updates does not', async () => {
    stubSettings(snapshot({ update: { mode: 'off', status: { kind: 'idle' } } }));
    render(<DesktopSettings />);
    expect(await screen.findByText('Esta versão não procura atualizações.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Procurar atualizações' })).not.toBeInTheDocument();
  });
});
