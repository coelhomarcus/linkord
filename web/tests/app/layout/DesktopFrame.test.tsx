import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DesktopFrame } from '@/app/layout/DesktopFrame';
import { useTitleBarHost } from '@/app/layout/titleBar';
import type { DesktopWindowControls, DesktopWindowState } from '@/shared/desktop';

function stubWindowControls(platform: string, initial: Partial<DesktopWindowState> = {}) {
  let listener: ((state: DesktopWindowState) => void) | null = null;
  const controls = {
    minimize: vi.fn(async () => {}),
    toggleMaximize: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    getState: vi.fn(async () => ({ maximized: false, fullScreen: false, focused: true, ...initial })),
    onStateChange: vi.fn((callback: (state: DesktopWindowState) => void) => {
      listener = callback;
      return () => { listener = null; };
    }),
  } satisfies DesktopWindowControls;
  window.linkordDesktop = { platform, version: '0.2.0', windowControls: controls };
  return { controls, emit: (state: DesktopWindowState) => act(() => listener?.(state)) };
}

function stubWideWindow(wide: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: wide && query === '(min-width: 768px)', media: query, onchange: null,
    addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }) as unknown as MediaQueryList);
}

function HostingBar() {
  const host = useTitleBarHost();
  return <div data-testid="hosting-bar">{host ? 'hosted' : 'not hosted'}</div>;
}

afterEach(() => {
  delete window.linkordDesktop;
  vi.restoreAllMocks();
});

describe('DesktopFrame', () => {
  it('adds nothing in a browser', () => {
    render(<DesktopFrame><p>page</p></DesktopFrame>);
    expect(screen.getByText('page')).toBeInTheDocument();
    expect(screen.queryByTestId('desktop-title-bar')).not.toBeInTheDocument();
  });

  it('adds nothing for a desktop build that keeps the system title bar', () => {
    window.linkordDesktop = { platform: 'win32', version: '0.1.0' };
    render(<DesktopFrame><p>page</p></DesktopFrame>);
    expect(screen.queryByTestId('desktop-title-bar')).not.toBeInTheDocument();
  });

  it('draws the Windows buttons and sends each one to the window', async () => {
    const { controls } = stubWindowControls('win32');
    const user = userEvent.setup();
    render(<DesktopFrame><p>page</p></DesktopFrame>);
    const group = screen.getByRole('group', { name: 'Controles da janela' });
    expect(group).toHaveAttribute('data-title-bar-style', 'windows');
    await user.click(screen.getByRole('button', { name: 'Minimizar' }));
    await user.click(screen.getByRole('button', { name: 'Maximizar' }));
    await user.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(controls.minimize).toHaveBeenCalledTimes(1);
    expect(controls.toggleMaximize).toHaveBeenCalledTimes(1);
    expect(controls.close).toHaveBeenCalledTimes(1);
  });

  it('offers to restore a maximised window, following the window as it changes', async () => {
    const { emit } = stubWindowControls('linux', { maximized: true });
    render(<DesktopFrame><p>page</p></DesktopFrame>);
    expect(await screen.findByRole('button', { name: 'Restaurar' })).toBeInTheDocument();
    emit({ maximized: false, fullScreen: false, focused: true });
    expect(screen.getByRole('button', { name: 'Maximizar' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Controles da janela' })).toHaveAttribute('data-title-bar-style', 'linux');
  });

  it('keeps the drag strip on macOS but leaves the buttons to the system', () => {
    stubWindowControls('darwin');
    render(<DesktopFrame><p>page</p></DesktopFrame>);
    expect(screen.getByTestId('desktop-title-bar')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Fechar' })).not.toBeInTheDocument();
  });

  it('maximises on a double click in the bar on Linux only', () => {
    const linux = stubWindowControls('linux');
    const { unmount } = render(<DesktopFrame><p>page</p></DesktopFrame>);
    fireEvent.doubleClick(screen.getByTestId('desktop-title-bar'));
    expect(linux.controls.toggleMaximize).toHaveBeenCalledTimes(1);
    // a double click on one of its buttons is two clicks on that button, not a maximise
    fireEvent.doubleClick(screen.getByRole('button', { name: 'Minimizar' }));
    expect(linux.controls.toggleMaximize).toHaveBeenCalledTimes(1);
    unmount();

    // Windows does it itself: a second toggle would undo it
    const windows = stubWindowControls('win32');
    render(<DesktopFrame><p>page</p></DesktopFrame>);
    fireEvent.doubleClick(screen.getByTestId('desktop-title-bar'));
    expect(windows.controls.toggleMaximize).not.toHaveBeenCalled();
  });

  it('gives way to the top bar where the top bar shows', async () => {
    stubWindowControls('win32');
    stubWideWindow(true);
    render(<DesktopFrame><HostingBar /></DesktopFrame>);
    expect(screen.getByTestId('hosting-bar')).toHaveTextContent('hosted');
    await waitFor(() => expect(screen.queryByTestId('desktop-title-bar')).not.toBeInTheDocument());
  });

  it('keeps its own bar in a narrow window, where the top bar is hidden', () => {
    stubWindowControls('win32');
    stubWideWindow(false);
    render(<DesktopFrame><HostingBar /></DesktopFrame>);
    expect(screen.getByTestId('desktop-title-bar')).toBeInTheDocument();
  });
});
