import { createContext, useContext, useEffect, useState } from 'react';
import type { MouseEvent } from 'react';
import { desktopApp, type DesktopWindowControls, type DesktopWindowState } from '@/shared/desktop';

// The desktop app's title bar, shared by DesktopFrame (its own bar) and
// TopBar (which takes its place where it shows).

export type TitleBarStyle = 'mac' | 'windows' | 'linux';

export function titleBarStyle(platform: string, controls?: DesktopWindowControls): TitleBarStyle {
  if (controls?.style) return controls.style;
  if (platform === 'darwin') return 'mac';
  if (platform === 'win32') return 'windows';
  return 'linux';
}

const INITIAL_STATE: DesktopWindowState = { maximized: false, fullScreen: false, focused: true };

export function useDesktopWindowState(controls: DesktopWindowControls): DesktopWindowState {
  const [state, setState] = useState(INITIAL_STATE);
  useEffect(() => {
    let live = true;
    controls.getState().then((current) => { if (live && current) setState(current); }, () => {});
    const unsubscribe = controls.onStateChange(setState);
    return () => {
      live = false;
      unsubscribe();
    };
  }, [controls]);
  return state;
}

export const TOP_BAR_QUERY = '(min-width: 768px)';

export const TitleBarHostContext = createContext<(() => () => void) | null>(null);

export interface TitleBarHost {
  controls: DesktopWindowControls;
  platform: string;
  /** Linux window managers do not maximise on a double click in a drawn bar; Windows and macOS do it themselves */
  onDoubleClick: (event: MouseEvent) => void;
}

export function hostFor(controls: DesktopWindowControls, platform: string): TitleBarHost {
  return {
    controls,
    platform,
    onDoubleClick: (event) => {
      if (titleBarStyle(platform, controls) !== 'linux' || event.target !== event.currentTarget) return;
      void controls.toggleMaximize();
    },
  };
}

/**
 * For a bar that takes the title bar's place (TopBar): the frame hides its
 * own while one is mounted. Null outside the desktop app, or in a build
 * that keeps the system title bar.
 */
export function useTitleBarHost(): TitleBarHost | null {
  const register = useContext(TitleBarHostContext);
  useEffect(() => register?.(), [register]);
  const desktop = desktopApp();
  return register && desktop?.windowControls ? hostFor(desktop.windowControls, desktop.platform) : null;
}

