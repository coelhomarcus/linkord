import { createContext, useContext, useEffect, useState } from 'react';
import { desktopApp, type DesktopWindowControls, type DesktopWindowState } from '@/shared/desktop';

// The desktop app's title bar, shared by DesktopFrame (its own bar) and
// TopBar (which takes its place where it shows).

export type TitleBarStyle = 'mac' | 'windows';

/** The desktop app ships for Windows; 'mac' is a development run on a Mac, or an old macOS install.
 * An old Linux install (0.3.x) asks for 'linux' and gets the Windows buttons, which work the same. */
export function titleBarStyle(platform: string, controls?: DesktopWindowControls): TitleBarStyle {
  const style = controls?.style ?? (platform === 'darwin' ? 'mac' : 'windows');
  return style === 'mac' ? 'mac' : 'windows';
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
  return register && desktop?.windowControls ? { controls: desktop.windowControls, platform: desktop.platform } : null;
}

