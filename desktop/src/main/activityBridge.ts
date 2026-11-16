import { BrowserWindow, ipcMain } from 'electron';
import { isAppPage } from './appPage.js';
import type { CurrentActivity, createActivityWatcher } from './activityWatcher.js';

// The same names are spelled out in src/preload/index.cts, which cannot import this file
const WATCH = 'linkord:activity:watch';
const CURRENT = 'linkord:activity:current';
const RECENT = 'linkord:activity:recent';
const ICON = 'linkord:activity:icon';
const CHANGED = 'linkord:activity:changed';

/** The page decides whether anything is shared: it turns the watcher on while the account shares its
 * activity, and off otherwise, so a person who turned it off is not even looked at. */
export function installActivityBridge(appOrigin: string, watcher: ReturnType<typeof createActivityWatcher>): void {
  ipcMain.handle(WATCH, (event, on: unknown) => {
    if (!isAppPage(event.senderFrame, appOrigin)) return;
    if (on === true) watcher.start();
    else watcher.stop();
  });
  ipcMain.handle(CURRENT, (event) => (isAppPage(event.senderFrame, appOrigin) ? watcher.current() : null));
  ipcMain.handle(RECENT, (event) => (isAppPage(event.senderFrame, appOrigin) ? watcher.recent() : []));
  ipcMain.handle(ICON, (event) => (isAppPage(event.senderFrame, appOrigin) ? watcher.icon() : null));
}

export function sendActivity(window: BrowserWindow | null, activity: CurrentActivity | null): void {
  if (window && !window.isDestroyed()) window.webContents.send(CHANGED, activity);
}
