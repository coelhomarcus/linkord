import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RoomContext } from '@/state/RoomContext';
import { createFakeRoomContextValue } from '@tests/fixtures/roomContextFixture';
import { InstallBanner } from '@/features/install/InstallBanner';
import { InstallSettingsSection } from '@/features/install/InstallSettingsSection';
import { recordInstallSession, startInstallPromptCapture } from '@/features/install/installPrompt';
import type { BeforeInstallPromptEvent } from '@/features/install/installPrompt';

const IOS_USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';

let stopCapture: () => void;

function fireInstallPrompt(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const event = new Event('beforeinstallprompt') as BeforeInstallPromptEvent;
  event.prompt = vi.fn(async () => {});
  event.userChoice = Promise.resolve({ outcome });
  act(() => { window.dispatchEvent(event); });
  return event;
}

function stubStandalone(standalone: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: standalone && query === '(display-mode: standalone)',
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

function renderBanner(overrides: Parameters<typeof createFakeRoomContextValue>[0] = {}) {
  return render(
    <RoomContext.Provider value={createFakeRoomContextValue(overrides)}>
      <InstallBanner />
    </RoomContext.Provider>,
  );
}

/** Sessions are counted per tab at startup, so each test begins as the Nth tab. */
function startAsSession(count: number) {
  localStorage.setItem('ss-install-sessions', String(count - 1));
  sessionStorage.clear();
  recordInstallSession();
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  stopCapture = startInstallPromptCapture();
});

afterEach(() => {
  stopCapture();
  vi.unstubAllGlobals();
});

describe('InstallBanner', () => {
  it('is hidden on the first visit even when the browser can install', () => {
    startAsSession(1);
    renderBanner();
    fireInstallPrompt();
    expect(screen.queryByText('Instale o Linkord')).not.toBeInTheDocument();
  });

  it('shows from the third session and installs through the browser dialog', async () => {
    startAsSession(3);
    renderBanner();
    const event = fireInstallPrompt();
    expect(await screen.findByText('Instale o Linkord')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Instalar' }));
    expect(event.prompt).toHaveBeenCalledOnce();
  });

  it('stays hidden once dismissed, and remembers it for the next visit', async () => {
    startAsSession(3);
    const first = renderBanner();
    fireInstallPrompt();
    await userEvent.click(await screen.findByRole('button', { name: 'Dispensar' }));
    expect(screen.queryByText('Instale o Linkord')).not.toBeInTheDocument();
    first.unmount();

    startAsSession(4);
    renderBanner();
    expect(screen.queryByText('Instale o Linkord')).not.toBeInTheDocument();
  });

  it('is dismissed for good when the person declines the browser dialog', async () => {
    startAsSession(3);
    renderBanner();
    fireInstallPrompt('dismissed');
    await userEvent.click(await screen.findByRole('button', { name: 'Instalar' }));
    expect(screen.queryByText('Instale o Linkord')).not.toBeInTheDocument();
    expect(localStorage.getItem('ss-install-banner-dismissed')).toBe('1');
  });

  it('is hidden while running as an installed app', () => {
    stubStandalone(true);
    startAsSession(3);
    renderBanner();
    fireInstallPrompt();
    expect(screen.queryByText('Instale o Linkord')).not.toBeInTheDocument();
  });

  it('is hidden during a call, and shows when it ends', () => {
    startAsSession(3);
    const view = renderBanner({ activeCallConversationId: 'c1' });
    fireInstallPrompt();
    expect(screen.queryByText('Instale o Linkord')).not.toBeInTheDocument();
    view.rerender(
      <RoomContext.Provider value={createFakeRoomContextValue({ activeCallConversationId: null })}>
        <InstallBanner />
      </RoomContext.Provider>,
    );
    expect(screen.getByText('Instale o Linkord')).toBeInTheDocument();
  });

  it('is hidden while a DM call is ringing', () => {
    startAsSession(3);
    renderBanner({ dmCall: { callId: 'k', conversationId: 'c', video: false, phase: 'incoming', callerId: 'a', peerId: 'b' } });
    fireInstallPrompt();
    expect(screen.queryByText('Instale o Linkord')).not.toBeInTheDocument();
  });

  it('is hidden once the app reports being installed', async () => {
    startAsSession(3);
    renderBanner();
    fireInstallPrompt();
    expect(await screen.findByText('Instale o Linkord')).toBeInTheDocument();
    act(() => { window.dispatchEvent(new Event('appinstalled')); });
    expect(screen.queryByText('Instale o Linkord')).not.toBeInTheDocument();
  });

  it('is hidden in a browser that neither offers a dialog nor is iOS', () => {
    startAsSession(3);
    renderBanner();
    expect(screen.queryByText('Instale o Linkord')).not.toBeInTheDocument();
  });

  describe('on iOS', () => {
    beforeEach(() => { vi.stubGlobal('navigator', Object.create(navigator, { userAgent: { value: IOS_USER_AGENT } })); });

    it('explains Share → Add to Home Screen, with no install button', () => {
      startAsSession(3);
      renderBanner();
      expect(screen.getByText(/Adicionar à Tela de Início/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Instalar' })).not.toBeInTheDocument();
    });

    it('is hidden when launched from the Home Screen icon', () => {
      vi.stubGlobal('navigator', Object.create(navigator, { userAgent: { value: IOS_USER_AGENT }, standalone: { value: true } }));
      startAsSession(3);
      renderBanner();
      expect(screen.queryByText('Instale o Linkord')).not.toBeInTheDocument();
    });

    it('is hidden on the first visit too', () => {
      startAsSession(1);
      renderBanner();
      expect(screen.queryByText('Instale o Linkord')).not.toBeInTheDocument();
    });
  });
});

describe('InstallSettingsSection', () => {
  it('lists the install entry from the first visit, even after the banner was dismissed', () => {
    localStorage.setItem('ss-install-banner-dismissed', '1');
    render(<InstallSettingsSection title="Instalar o app" />);
    expect(screen.queryByRole('heading', { name: 'Instalar o app' })).not.toBeInTheDocument();
    fireInstallPrompt();
    expect(screen.getByRole('heading', { name: 'Instalar o app' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Instalar' })).toBeInTheDocument();
  });

  it('shows the instructions on iOS', () => {
    vi.stubGlobal('navigator', Object.create(navigator, { userAgent: { value: IOS_USER_AGENT } }));
    render(<InstallSettingsSection title="Instalar o app" />);
    expect(screen.getByText('Adicionar à Tela de Início')).toBeInTheDocument();
  });

  it('is absent when running standalone', () => {
    stubStandalone(true);
    render(<InstallSettingsSection title="Instalar o app" />);
    fireInstallPrompt();
    expect(screen.queryByRole('heading', { name: 'Instalar o app' })).not.toBeInTheDocument();
  });
});
