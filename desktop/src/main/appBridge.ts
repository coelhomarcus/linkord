import { BrowserWindow, app, ipcMain } from 'electron';
import { isAppPage } from './appPage.js';
import { parseBadgeCount } from './badge.js';

// The same names are spelled out in src/preload/index.cts, which cannot import this file
const FOCUS_WINDOW = 'linkord:window:focus';
const SET_BADGE = 'linkord:badge:set';

export function installAppBridge(appOrigin: string): void {
  // A notification clicked while the window is hidden (closed on macOS) or
  // minimised: window.focus() from the page cannot bring it back
  ipcMain.handle(FOCUS_WINDOW, (event) => {
    if (!isAppPage(event.senderFrame, appOrigin)) return;
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });

  // macOS dock and Linux launchers; Windows has no count on the taskbar icon
  ipcMain.handle(SET_BADGE, (event, value: unknown) => {
    if (!isAppPage(event.senderFrame, appOrigin)) return false;
    const count = parseBadgeCount(value);
    return count === null ? false : app.setBadgeCount(count);
  });
}
