import { ipcMain } from 'electron';
import { isAppPage } from './appPage.js';
import { isLoadFailure } from './loadRetry.js';
import type { MainWindow } from './mainWindow.js';

// The same names are spelled out in src/preload/index.cts, which cannot import this file
const OPEN = 'linkord:deep-link:open';
const READY = 'linkord:deep-link:ready';

/**
 * Opens a page named by a `linkord://` link (a path deepLink.ts built) in the
 * main window. A page that listens moves there through its own router, so a
 * call keeps going; reloading would end it (the call lives in the page). One
 * that does not listen yet (still loading, failed, or a build from before
 * deep links) loads the path instead.
 */
export function installDeepLinkBridge(main: MainWindow, appOrigin: string): (path: string) => void {
  const { window } = main;
  const contents = window.webContents;
  let listening = false;

  ipcMain.on(READY, (event) => {
    if (event.sender === contents && isAppPage(event.senderFrame, appOrigin)) listening = true;
  });
  // A new document starts deaf until its app says otherwise
  contents.on('did-navigate', () => { listening = false; });
  contents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => { if (isLoadFailure(code, isMainFrame)) listening = false; });
  contents.on('render-process-gone', () => { listening = false; });

  return (path) => {
    if (window.isDestroyed()) return;
    if (listening) contents.send(OPEN, path);
    else main.load(new URL(path, appOrigin));
  };
}
