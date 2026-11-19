import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { DownloadsSettings } from '@/features/settings/DownloadsSettings';
import { startInstallPromptCapture } from '@/features/install/installPrompt';

const fetchDownloads = vi.hoisted(() => vi.fn());
vi.mock('@/features/desktopApp/desktopDownloads', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/desktopApp/desktopDownloads')>()),
  fetchDesktopDownloads: fetchDownloads,
}));

const downloads = {
  version: '0.3.0',
  page: 'https://github.com/o/r/releases/tag/v0.3.0',
  files: { windows: 'https://github.com/o/r/releases/download/v0.3.0/Linkord-0.3.0-win-x64.exe' },
};
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/142.0';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';
const originalUserAgent = navigator.userAgent;

function useUserAgent(ua: string) {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
}

function renderPage() {
  return renderWithRoom(<MemoryRouter><DownloadsSettings /></MemoryRouter>);
}

const card = (name: string) => screen.getByRole('article', { name });

let stopCapture: () => void;
beforeEach(() => {
  fetchDownloads.mockReset().mockResolvedValue(downloads);
  useUserAgent(WINDOWS);
  stopCapture = startInstallPromptCapture();
});

afterEach(() => {
  stopCapture();
  delete window.linkordDesktop;
  useUserAgent(originalUserAgent);
});

describe('DownloadsSettings', () => {
  it('offers the latest Windows installer and recommends it on a Windows computer', async () => {
    renderPage();
    const windows = card('App para Windows');
    expect(await within(windows).findByRole('link', { name: 'Baixar para Windows' })).toHaveAttribute('href', downloads.files.windows);
    expect(within(windows).getByText('Versão 0.3.0')).toBeInTheDocument();
    expect(within(windows).getByRole('link', { name: 'Todas as versões' })).toHaveAttribute('href', downloads.page);
    expect(within(windows).getByText('Recomendado para você')).toBeInTheDocument();
    expect(within(card('Web app')).queryByText('Recomendado para você')).not.toBeInTheDocument();
  });

  it('says when no installer is published, and reads it again on request', async () => {
    fetchDownloads.mockRejectedValueOnce(Object.assign(new Error('not found'), { status: 404 }));
    renderPage();
    const windows = card('App para Windows');
    expect(await within(windows).findByText('O instalador não está disponível agora.')).toBeInTheDocument();
    await userEvent.setup().click(within(windows).getByRole('button', { name: 'Tentar de novo' }));
    expect(await within(windows).findByRole('link', { name: 'Baixar para Windows' })).toBeInTheDocument();
  });

  it('recommends the web app elsewhere and opens the browser\'s install dialog', async () => {
    useUserAgent(ANDROID);
    const prompt = vi.fn().mockResolvedValue(undefined);
    renderPage();
    const web = card('Web app');
    expect(within(web).getByText('Recomendado para você')).toBeInTheDocument();
    expect(within(web).getByText(/Este navegador não oferece a instalação/)).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(Object.assign(new Event('beforeinstallprompt'), { prompt, userChoice: Promise.resolve({ outcome: 'accepted' }) }));
    });
    await userEvent.setup().click(within(web).getByRole('button', { name: 'Instalar web app' }));
    expect(prompt).toHaveBeenCalledOnce();

    act(() => { window.dispatchEvent(new Event('appinstalled')); });
    expect(within(web).getByText('O web app está instalado neste aparelho.')).toBeInTheDocument();
  });

  it('walks an iPhone through Add to Home Screen', () => {
    useUserAgent(IPHONE);
    renderPage();
    const steps = within(card('Web app')).getAllByRole('listitem').map((item) => item.textContent);
    expect(steps).toEqual(expect.arrayContaining(['1Toque em Compartilhar', '2Escolha “Adicionar à Tela de Início”', '3Toque em Adicionar']));
  });

  it('inside the desktop app, says it is the app in use and points the web app to the phone', () => {
    window.linkordDesktop = { platform: 'win32', version: '0.3.0' };
    renderPage();
    expect(within(card('App para Windows')).getByText('Você está usando o app para Windows.')).toBeInTheDocument();
    expect(within(card('Web app')).getByText(/abra o site no navegador do celular/)).toBeInTheDocument();
    expect(screen.queryByText('Recomendado para você')).not.toBeInTheDocument();
    expect(fetchDownloads).not.toHaveBeenCalled();
  });
});
