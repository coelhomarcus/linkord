import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DesktopUpdateButton } from '@/features/desktopApp/DesktopUpdateButton';
import type { DesktopSettingsApi, DesktopSettingsSnapshot, DesktopUpdateStatus } from '@/shared/desktop';

function snapshot(status: DesktopUpdateStatus): DesktopSettingsSnapshot {
  return {
    version: '0.3.0',
    startAtLogin: { available: true, enabled: false },
    closeToTray: true,
    startMinimized: true,
    update: { mode: 'install', status },
  };
}

function stubDesktop(status: DesktopUpdateStatus) {
  let listener: ((settings: DesktopSettingsSnapshot) => void) | null = null;
  const api = {
    get: vi.fn(async () => snapshot(status)),
    set: vi.fn(async () => snapshot(status)),
    checkForUpdates: vi.fn(async () => ({ kind: 'up-to-date' as const })),
    applyUpdate: vi.fn(async () => {}),
    onChange: vi.fn((callback: (settings: DesktopSettingsSnapshot) => void) => {
      listener = callback;
      return () => { listener = null; };
    }),
  } satisfies DesktopSettingsApi;
  window.overcordDesktop = { platform: 'win32', version: '0.3.0', settings: api };
  return { api, push: (next: DesktopUpdateStatus) => act(() => listener?.(snapshot(next))) };
}

afterEach(() => { delete window.overcordDesktop; });

describe('DesktopUpdateButton', () => {
  it('shows nothing in a browser', () => {
    const { container } = render(<DesktopUpdateButton />);
    expect(container).toBeEmptyDOMElement();
  });

  it('appears once the update is downloaded, not while it downloads', async () => {
    const { api, push } = stubDesktop({ kind: 'idle' });
    render(<DesktopUpdateButton />);
    await vi.waitFor(() => expect(api.get).toHaveBeenCalled());
    push({ kind: 'downloading', version: '0.4.0', percent: 60 });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    push({ kind: 'downloaded', version: '0.4.0' });
    expect(screen.getByRole('button', { name: 'Atualização pronta! Reiniciar para atualizar' })).toBeInTheDocument();
  });

  it('restarts into the update', async () => {
    const { api } = stubDesktop({ kind: 'downloaded', version: '0.4.0' });
    const user = userEvent.setup();
    render(<DesktopUpdateButton />);
    await user.click(await screen.findByRole('button', { name: 'Atualização pronta! Reiniciar para atualizar' }));
    expect(api.applyUpdate).toHaveBeenCalledTimes(1);
  });
});
