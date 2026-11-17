import path from 'node:path';
import { BrowserWindow, ipcMain } from 'electron';
import { SECURE_WEB_PREFERENCES } from './contentsGuard.js';
import type { Strings } from './strings.js';
import { updaterView, type UpdaterAction, type UpdaterScreen } from './updaterScreen.js';

// The app's own small window, as Discord has: every start opens with it alone
// on screen, through the update check, the download and install of an update
// found, and the connection to the server, until the app's page has loaded.
// It also shows a check the tray asks for, and replaces the system's dialogs
// and notifications (assets/updater.html draws it).

const PAGE = path.join(import.meta.dirname, '../../assets/updater.html');
const PRELOAD = path.join(import.meta.dirname, '../preload/updater.cjs');
const SIZE = { width: 300, height: 340 };
const BACKGROUND = '#1b1b1f';

export interface UpdaterWindow {
  show(screen: UpdaterScreen): void;
  close(): void;
  isOpen(): boolean;
  /** brings the window to the front, when it is up */
  focus(): void;
}

/**
 * onAction also hears 'later' when the window is closed some other way
 * (Alt+F4), unless mayClose refuses it.
 */
export function createUpdaterWindow(strings: Strings, onAction: (action: UpdaterAction) => void, mayClose: () => boolean): UpdaterWindow {
  let window: BrowserWindow | null = null;
  let ready: Promise<void> = Promise.resolve();
  let closingOurselves = false;

  const ensure = () => {
    if (window && !window.isDestroyed()) return window;
    const created = new BrowserWindow({
      ...SIZE,
      show: false,
      frame: false,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      center: true,
      title: 'Linkord',
      backgroundColor: BACKGROUND,
      webPreferences: { ...SECURE_WEB_PREFERENCES, preload: PRELOAD, spellcheck: false },
    });
    created.on('close', (event) => {
      if (!closingOurselves && !mayClose()) event.preventDefault();
    });
    created.on('closed', () => {
      if (window === created) window = null;
      if (!closingOurselves) onAction('later');
      closingOurselves = false;
    });
    ready = created.loadFile(PAGE).catch((error: unknown) => console.error('[desktop] updater window did not load', error));
    window = created;
    return created;
  };

  ipcMain.on('linkord:updater:action', (event, action: unknown) => {
    if (!window || event.sender !== window.webContents) return;
    if (action === 'restart' || action === 'later' || action === 'retry') onAction(action);
  });

  return {
    show(screen) {
      const target = ensure();
      const view = updaterView(screen, strings);
      void ready.then(() => {
        if (target.isDestroyed()) return;
        target.webContents.send('linkord:updater:render', view);
        if (!target.isVisible()) target.show();
      });
    },
    close() {
      if (!window || window.isDestroyed()) return;
      closingOurselves = true;
      window.close();
    },
    isOpen: () => window !== null && !window.isDestroyed(),
    focus() {
      if (!window || window.isDestroyed()) return;
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    },
  };
}
