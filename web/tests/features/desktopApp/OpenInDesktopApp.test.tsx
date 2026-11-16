import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { OpenInDesktopApp } from '@/features/desktopApp/OpenInDesktopApp';
import { desktopInviteLink } from '@/features/desktopApp/desktopLinks';

const fetchDownloads = vi.hoisted(() => vi.fn());
vi.mock('@/features/desktopApp/desktopDownloads', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/desktopApp/desktopDownloads')>()),
  fetchDesktopDownloads: fetchDownloads,
}));

const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const downloads = { version: '0.3.0', page: 'https://example.com/releases', files: { windows: 'https://example.com/Linkord.exe' } };

function useUserAgent(ua: string) {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
}

beforeEach(() => {
  fetchDownloads.mockReset().mockResolvedValue(downloads);
  useUserAgent(WINDOWS);
});

afterEach(() => { delete window.linkordDesktop; });

describe('desktopInviteLink', () => {
  it('builds the link only for a code the desktop app accepts', () => {
    expect(desktopInviteLink('aB3dEf7h')).toBe('linkord://invite/aB3dEf7h');
    expect(desktopInviteLink('ab')).toBeNull();
    expect(desktopInviteLink('abcd/../x')).toBeNull();
  });
});

describe('OpenInDesktopApp', () => {
  it('offers the app on Windows when there is a release to install', async () => {
    render(<OpenInDesktopApp link="linkord://invite/aB3dEf7h" />);
    expect(await screen.findByRole('link', { name: 'Abrir no app' })).toHaveAttribute('href', 'linkord://invite/aB3dEf7h');
  });

  it('stays out inside the desktop app, on other systems, without a release or a link', async () => {
    window.linkordDesktop = { platform: 'win32', version: '0.3.0' };
    const inApp = render(<OpenInDesktopApp link="linkord://invite/aB3dEf7h" />);
    expect(fetchDownloads).not.toHaveBeenCalled();
    inApp.unmount();
    delete window.linkordDesktop;

    const noLink = render(<OpenInDesktopApp link={null} />);
    expect(fetchDownloads).not.toHaveBeenCalled();
    noLink.unmount();

    useUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15');
    const mac = render(<OpenInDesktopApp link="linkord://invite/aB3dEf7h" />);
    expect(fetchDownloads).not.toHaveBeenCalled();
    mac.unmount();

    useUserAgent(WINDOWS);
    fetchDownloads.mockResolvedValue({ ...downloads, files: {} });
    render(<OpenInDesktopApp link="linkord://invite/aB3dEf7h" />);
    await waitFor(() => expect(fetchDownloads).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
