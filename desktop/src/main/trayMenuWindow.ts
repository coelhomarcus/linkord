import path from 'node:path';
import { BrowserWindow, ipcMain, screen } from 'electron';
import { SECURE_WEB_PREFERENCES } from './contentsGuard.js';
import type { TrayMenuItem } from './menus.js';
import { echoesTrayClick, trayMenuPosition, trayMenuSize } from './trayMenuLayout.js';

// Windows draws a tray's context menu as a classic Win32 menu, which looks
// nothing like the app. There the tray opens this small window instead: the
// same items (menus.ts), drawn by assets/tray-menu.html in the app's colours.
// A development run on a Mac keeps the native menu.

const PAGE = path.join(import.meta.dirname, '../../assets/tray-menu.html');
const PRELOAD = path.join(import.meta.dirname, '../preload/trayMenu.cjs');

export interface TrayMenuModel {
  title: string;
  version: string;
  items: TrayMenuItem[];
}

export function createTrayMenuWindow(onChoose: (id: string, checked: boolean) => void) {
  let window: BrowserWindow | null = null;
  let ready: Promise<void> | null = null;
  let openedAt: number | null = null;

  const ensure = () => {
    if (window && !window.isDestroyed()) return window;
    window = new BrowserWindow({
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      webPreferences: { ...SECURE_WEB_PREFERENCES, preload: PRELOAD, spellcheck: false },
    });
    // A click anywhere else closes it, as a menu does
    window.on('blur', () => window?.hide());
    ready = window.loadFile(PAGE).catch((error: unknown) => console.error('[desktop] tray menu did not load', error));
    return window;
  };

  ipcMain.on('overcord:tray-menu:choose', (event, id: unknown, checked: unknown) => {
    if (!window || event.sender !== window.webContents) return;
    window.hide();
    if (typeof id === 'string') onChoose(id, checked === true);
  });
  ipcMain.on('overcord:tray-menu:close', (event) => {
    if (window && event.sender === window.webContents) window.hide();
  });

  return {
    async show(model: TrayMenuModel) {
      const menu = ensure();
      await ready;
      if (echoesTrayClick(openedAt, Date.now())) {
        if (!menu.isVisible()) menu.show();
        menu.focus();
        return;
      }
      openedAt = Date.now();
      const pointer = screen.getCursorScreenPoint();
      const size = trayMenuSize(model.items);
      const { x, y } = trayMenuPosition(pointer, size, screen.getDisplayNearestPoint(pointer).bounds);
      menu.setBounds({ x, y, ...size });
      menu.webContents.send('overcord:tray-menu:render', model);
      menu.show();
      menu.focus();
    },
  };
}
