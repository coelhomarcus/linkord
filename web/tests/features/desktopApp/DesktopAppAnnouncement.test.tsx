import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { DesktopAppAnnouncement } from '@/features/desktopApp/DesktopAppAnnouncement';

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

function useUserAgent(ua: string) {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
}

beforeEach(() => {
  localStorage.clear();
  fetchDownloads.mockReset().mockResolvedValue(downloads);
  useUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36');
});

afterEach(() => { delete window.linkordDesktop; });

describe('DesktopAppAnnouncement', () => {
  it('announces the desktop app once, with this computer\'s installer', async () => {
    const { unmount } = renderWithRoom(<DesktopAppAnnouncement />);
    expect(await screen.findByRole('dialog', { name: 'O Linkord agora tem app para computador' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Baixar para Windows' })).toHaveAttribute('href', downloads.files.windows);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Agora não' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    unmount();

    renderWithRoom(<DesktopAppAnnouncement />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('waits for a call to end', async () => {
    renderWithRoom(<DesktopAppAnnouncement />, { activeCallConversationId: 'call' });
    await waitFor(() => expect(fetchDownloads).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(localStorage.getItem('ss-desktop-app-announced')).toBeNull();
  });

  it('says nothing inside the desktop app, outside Windows, or without a release', async () => {
    window.linkordDesktop = { platform: 'win32', version: '0.3.0' };
    const { unmount } = renderWithRoom(<DesktopAppAnnouncement />);
    expect(fetchDownloads).not.toHaveBeenCalled();
    unmount();
    delete window.linkordDesktop;

    for (const ua of ['Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/142.0', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15']) {
      useUserAgent(ua);
      const other = renderWithRoom(<DesktopAppAnnouncement />);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(fetchDownloads).not.toHaveBeenCalled();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      other.unmount();
    }

    useUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/142.0');
    fetchDownloads.mockRejectedValue(new Error('404'));
    renderWithRoom(<DesktopAppAnnouncement />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
