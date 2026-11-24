import type { BrowserWindowConstructorOptions } from 'electron';

// The system's title bar is hidden and the page draws its own (TopBar and
// the window controls in web/src/app/layout), so the app's chrome runs to the
// window's edge. Windows gets no system buttons at all and the page draws
// them; a development run on a Mac keeps the traffic lights, placed in the bar.

/** The page's title bar height (web/src/styles/index.css, --spacing-titlebar). */
export const TITLE_BAR_HEIGHT = 32;

// The traffic lights are 14 px tall: centred in the bar
const TRAFFIC_LIGHTS = { x: 12, y: (TITLE_BAR_HEIGHT - 14) / 2 };

export type TitleBarStyle = 'mac' | 'windows';

/**
 * Which buttons the page draws. LINKORD_TITLE_BAR=windows shows the Windows
 * bar in a development run on a Mac.
 */
export function titleBarStyle(input: {
  platform: NodeJS.Platform;
  env: Readonly<Record<string, string | undefined>>;
  isPackaged: boolean;
}): TitleBarStyle {
  const override = input.env.LINKORD_TITLE_BAR;
  if (!input.isPackaged && (override === 'mac' || override === 'windows')) return override;
  return input.platform === 'darwin' ? 'mac' : 'windows';
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

/**
 * The page's request to put the window in fullscreen or take it out, or null when it is not one.
 * The page asks for the window's fullscreen rather than an element's because Chromium leaves an
 * element's on Esc, and the page needs Esc for itself (the playground's screens and pause menu).
 */
export function parseFullScreenRequest(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}
