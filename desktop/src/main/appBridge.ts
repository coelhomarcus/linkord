import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { isAppPage } from './appPage.js';
import { parseBadgeCount } from './badge.js';
import type { Strings } from './strings.js';
import { setTaskbarBadge } from './taskbarBadge.js';
import { parseFullScreenRequest, windowState } from './titleBar.js';

// The same names are spelled out in src/preload/index.cts, which cannot import this file
const FOCUS_WINDOW = 'linkord:window:focus';
const SET_BADGE = 'linkord:badge:set';
const MINIMIZE = 'linkord:window:minimize';
const TOGGLE_MAXIMIZE = 'linkord:window:toggle-maximize';
const CLOSE = 'linkord:window:close';
const GET_STATE = 'linkord:window:get-state';
const STATE_CHANGED = 'linkord:window:state';
const SET_FULL_SCREEN = 'linkord:window:set-full-screen';

export function installAppBridge(appOrigin: string, strings: Strings): void {
  // A notification clicked while the window is hidden (in the tray) or
  // minimised: window.focus() from the page cannot bring it back
  ipcMain.handle(FOCUS_WINDOW, (event) => {
    if (!isAppPage(event.senderFrame, appOrigin)) return;
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) bringBack(window);
  });

  // The page's own title bar buttons (the system's are hidden, see titleBar.ts)
  const appWindow = (event: IpcMainInvokeEvent) =>
    isAppPage(event.senderFrame, appOrigin) ? BrowserWindow.fromWebContents(event.sender) : null;
  ipcMain.handle(MINIMIZE, (event) => { appWindow(event)?.minimize(); });
  ipcMain.handle(TOGGLE_MAXIMIZE, (event) => {
    const window = appWindow(event);
    if (!window) return;
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
  });
  // The window's close handler decides what closing means (hide to the tray)
  ipcMain.handle(CLOSE, (event) => { appWindow(event)?.close(); });
  // The call stage and a tile fill a fullscreen window (web/src/shared/lib/fullscreen.ts)
  ipcMain.handle(SET_FULL_SCREEN, (event, value: unknown) => {
    const window = appWindow(event);
    const on = parseFullScreenRequest(value);
    if (window && on !== null) window.setFullScreen(on);
  });
  ipcMain.handle(GET_STATE, (event) => {
    const window = appWindow(event);
    return window ? windowState(window) : null;
  });

  // The unread count on the taskbar button (taskbarBadge.ts)
  ipcMain.handle(SET_BADGE, (event, value: unknown) => {
    const window = appWindow(event);
    const count = parseBadgeCount(value);
    return window && count !== null ? setTaskbarBadge(window, count, strings) : false;
  });
}

/** Shows the window, from the tray, and puts it in front. */
export function bringBack(window: BrowserWindow): void {
  if (window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

/** Tells the page when its maximise button should read "restore", fullscreen hides the bar's inset, or focus dims it. */
export function forwardWindowState(window: BrowserWindow): void {
  const send = () => {
    if (!window.isDestroyed()) window.webContents.send(STATE_CHANGED, windowState(window));
  };
  window.on('maximize', send);
  window.on('unmaximize', send);
  window.on('restore', send);
  window.on('enter-full-screen', send);
  window.on('leave-full-screen', send);
  window.on('focus', send);
  window.on('blur', send);
}
