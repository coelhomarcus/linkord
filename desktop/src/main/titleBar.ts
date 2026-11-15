import type { BrowserWindowConstructorOptions } from 'electron';

// The system's title bar is hidden and the page draws its own (TopBar and
// the window controls in web/src/app/layout), so the app's chrome runs to the
// window's edge. macOS keeps its traffic lights, placed in the page's bar;
// Windows and Linux get no system buttons at all and the page draws them.

/** The page's title bar height (web/src/styles/index.css, --spacing-titlebar). */
export const TITLE_BAR_HEIGHT = 32;

// The traffic lights are 14 px tall: centred in the bar
const TRAFFIC_LIGHTS = { x: 12, y: (TITLE_BAR_HEIGHT - 14) / 2 };

export type TitleBarStyle = 'mac' | 'windows' | 'linux';

/**
 * Which system's buttons the page draws. LINKORD_TITLE_BAR overrides it in a
 * development run, to look at another system's bar without that system.
 */
export function titleBarStyle(input: {
  platform: NodeJS.Platform;
  env: Readonly<Record<string, string | undefined>>;
  isPackaged: boolean;
}): TitleBarStyle {
  const override = input.env.LINKORD_TITLE_BAR;
  if (!input.isPackaged && (override === 'mac' || override === 'windows' || override === 'linux')) return override;
  if (input.platform === 'darwin') return 'mac';
  return input.platform === 'win32' ? 'windows' : 'linux';
}

export function titleBarOptions(platform: NodeJS.Platform): Pick<BrowserWindowConstructorOptions, 'titleBarStyle' | 'trafficLightPosition'> {
  return platform === 'darwin'
    ? { titleBarStyle: 'hidden', trafficLightPosition: TRAFFIC_LIGHTS }
    : { titleBarStyle: 'hidden' };
}

export interface WindowState {
  maximized: boolean;
  fullScreen: boolean;
  focused: boolean;
}

export function windowState(window: { isMaximized(): boolean; isFullScreen(): boolean; isFocused(): boolean }): WindowState {
  return { maximized: window.isMaximized(), fullScreen: window.isFullScreen(), focused: window.isFocused() };
}
