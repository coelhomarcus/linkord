import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { useDesktopLinks } from '@/features/desktopApp/useDesktopLinks';

function Probe() {
  useDesktopLinks();
  const location = useLocation();
  return <p data-testid="path">{location.pathname}{location.search}</p>;
}

afterEach(() => { delete window.overcordDesktop; });

function withDesktopApp() {
  let deliver: ((path: string) => void) | null = null;
  const unsubscribe = vi.fn();
  window.overcordDesktop = {
    platform: 'win32',
    version: '0.4.0',
    onDeepLink: (callback) => {
      deliver = callback;
      return unsubscribe;
    },
  };
  return { open: (path: string) => act(() => deliver?.(path)), unsubscribe };
}

describe('useDesktopLinks', () => {
  it('moves to the invite or conversation a overcord:// link names', () => {
    const app = withDesktopApp();
    render(<MemoryRouter initialEntries={['/friends']}><Probe /></MemoryRouter>);
    app.open('/invite/aB3dEf7h');
    expect(screen.getByTestId('path')).toHaveTextContent('/invite/aB3dEf7h');
    app.open('/channels/@me/c1?message=42');
    expect(screen.getByTestId('path')).toHaveTextContent('/channels/@me/c1?message=42');
  });

  it('follows the /app path an older desktop app hands over', () => {
    const app = withDesktopApp();
    render(<MemoryRouter initialEntries={['/friends']}><Probe /></MemoryRouter>);
    app.open('/app/channels/@me/c1?message=42');
    expect(screen.getByTestId('path')).toHaveTextContent('/channels/@me/c1?message=42');
  });

  it('ignores any other path', () => {
    const app = withDesktopApp();
    render(<MemoryRouter initialEntries={['/friends']}><Probe /></MemoryRouter>);
    app.open('/settings/account');
    app.open('https://evil.example/invite/abcd');
    expect(screen.getByTestId('path')).toHaveTextContent('/friends');
  });

  it('stops listening when unmounted, and does nothing in the browser or an older app', () => {
    const app = withDesktopApp();
    const { unmount } = render(<MemoryRouter><Probe /></MemoryRouter>);
    unmount();
    expect(app.unsubscribe).toHaveBeenCalled();

    window.overcordDesktop = { platform: 'win32', version: '0.3.0' };
    expect(() => render(<MemoryRouter><Probe /></MemoryRouter>)).not.toThrow();
  });
});
