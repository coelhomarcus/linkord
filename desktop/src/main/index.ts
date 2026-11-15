import path from 'node:path';
import { app, dialog, session, type BrowserWindow } from 'electron';
import { installAppBridge } from './appBridge.js';
import { resolveAppUrl } from './appUrl.js';
import { guardContents } from './contentsGuard.js';
import { capturesSystemAudio, sharePicker } from './displayMedia.js';
import { createMainWindow } from './mainWindow.js';
import { installScreenShare } from './screenShare.js';
import { installPermissionHandlers } from './session.js';

const resolved = resolveAppUrl({ argv: process.argv, env: process.env, isPackaged: app.isPackaged });

if (!resolved.ok) {
  // Only a misconfigured build gets here; a server picker replaces this before release
  const detail = resolved.reason === 'missing'
    ? 'Set LINKORD_URL or pass --url=<address> to choose the Linkord server.'
    : resolved.reason === 'insecure'
      ? `${resolved.value} uses http; only https is allowed outside this machine.`
      : `${resolved.value} is not a valid http(s) address.`;
  app.whenReady().then(() => {
    dialog.showErrorBox('Linkord', detail);
    app.exit(1);
  });
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  const appUrl = resolved.url;
  let mainWindow: BrowserWindow | null = null;
  let quitting = false;

  const showMainWindow = () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  };

  if (process.platform === 'win32') app.setAppUserModelId('app.linkord.desktop');

  app.on('web-contents-created', (_event, contents) => guardContents(contents, appUrl.origin));
  app.on('second-instance', showMainWindow);
  app.on('before-quit', () => { quitting = true; });
  app.on('activate', showMainWindow);
  // On macOS closing the window only hides it, so a call keeps going
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

  app.whenReady().then(() => {
    const picker = sharePicker({ platform: process.platform, systemVersion: process.getSystemVersion(), env: process.env });
    installPermissionHandlers(session.defaultSession, appUrl.origin);
    installScreenShare(session.defaultSession, appUrl.origin, picker);
    installAppBridge(appUrl.origin);
    mainWindow = createMainWindow({
      appUrl,
      stateFile: path.join(app.getPath('userData'), 'window-state.json'),
      preload: path.join(import.meta.dirname, '../preload/index.cjs'),
      preloadArguments: [
        `--linkord-desktop-version=${app.getVersion()}`,
        `--linkord-share-picker=${picker}`,
        `--linkord-system-audio=${capturesSystemAudio(process.platform) ? '1' : '0'}`,
      ],
    });
    mainWindow.on('close', (event) => {
      if (process.platform !== 'darwin' || quitting) return;
      event.preventDefault();
      mainWindow?.hide();
    });
    mainWindow.on('closed', () => { mainWindow = null; });
  });
}
