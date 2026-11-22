import { format, type Strings } from './strings.js';
import type { TitleBarStyle } from './titleBar.js';

// What the main window shows while the app's page is not there
// (mainWindow.ts, assets/connection.html): the server is being reached, did
// not answer and is tried again at a set time, or the page crashed too many
// times in a row (loadRetry.ts). As in updaterScreen.ts, the text is made
// here and the page only draws it.

export type ConnectionScreen =
  | { kind: 'connecting' }
  /** retryAt: when the next attempt starts (ms since the epoch) */
  | { kind: 'waiting'; retryAt: number }
  | { kind: 'crashed' };

/**
 * Everything the screen may ask for. Besides trying again, the window's own
 * buttons: on Windows the window has no system title bar, and the app's page,
 * which draws one, is not there.
 */
export type ConnectionAction = 'retry' | 'minimize' | 'toggle-maximize' | 'close';

const ACTIONS: readonly ConnectionAction[] = ['retry', 'minimize', 'toggle-maximize', 'close'];

export function parseConnectionAction(value: unknown): ConnectionAction | null {
  return ACTIONS.find((action) => action === value) ?? null;
}

export interface ConnectionView {
  title: string;
  /** read out with the title when it changes */
  detail: string;
  /** a bar that only says something is happening */
  busy: boolean;
  /** the time left before the next attempt, redrawn every second and not read out */
  countdown: string;
  tone: 'neutral' | 'error';
  actions: { id: 'retry'; label: string }[];
  /** drawn by the page where the system draws none (a development run on a Mac keeps its traffic lights) */
  windowControls: { style: 'windows'; maximized: boolean; group: string; minimize: string; maximize: string; close: string } | null;
}

export function secondsUntil(retryAt: number, now: number): number {
  return Math.max(1, Math.ceil((retryAt - now) / 1000));
}

export function connectionView(
  screen: ConnectionScreen,
  strings: Strings,
  context: { now: number; titleBar: TitleBarStyle; maximized: boolean },
): ConnectionView {
  const windowControls = context.titleBar === 'mac' ? null : {
    style: context.titleBar,
    maximized: context.maximized,
    group: strings.windowControls,
    minimize: strings.minimize,
    maximize: context.maximized ? strings.restore : strings.maximize,
    close: strings.close,
  };
  switch (screen.kind) {
    case 'connecting':
      return { title: strings.connecting, detail: '', busy: true, countdown: '', tone: 'neutral', actions: [], windowControls };
    case 'waiting':
      return {
        title: strings.connectFailed,
        detail: strings.connectFailedDetail,
        busy: false,
        countdown: format(strings.connectRetryIn, { seconds: String(secondsUntil(screen.retryAt, context.now)) }),
        tone: 'neutral',
        actions: [{ id: 'retry', label: strings.tryNow }],
        windowControls,
      };
    case 'crashed':
      return {
        title: strings.crashedTitle,
        detail: strings.crashedBody,
        busy: false,
        countdown: '',
        tone: 'error',
        actions: [{ id: 'retry', label: strings.reload }],
        windowControls,
      };
  }
}

/** Whether an address is the screen's page, whatever its query or fragment. */
export function isScreenUrl(url: string, screenUrl: string): boolean {
  try {
    const parsed = new URL(url);
    const screen = new URL(screenUrl);
    return parsed.protocol === 'file:' && parsed.protocol === screen.protocol && parsed.pathname === screen.pathname;
  } catch {
    return false;
  }
}

/**
 * Whether a message comes from the screen itself, the window's top-level
 * frame: the window loads the app's page too, and that page, or something
 * embedded in it, must not reach the screen's actions.
 */
export function isScreenFrame(frame: { parent: unknown; url: string } | null | undefined, screenUrl: string): boolean {
  return !!frame && frame.parent === null && isScreenUrl(frame.url, screenUrl);
}
