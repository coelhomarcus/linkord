import fs from 'node:fs';
import path from 'node:path';
import { Menu, app, dialog, powerMonitor, session, type BrowserWindow, type Tray } from 'electron';
import { installAppBridge } from './appBridge.js';
import { parseAppConfig, resolveAppUrl } from './appUrl.js';
import { guardContents } from './contentsGuard.js';
import { capturesSystemAudio, sharePicker } from './displayMedia.js';
import { createMainWindow } from './mainWindow.js';
import { trayMenuTemplate, type MenuActions } from './menus.js';
import { installScreenShare } from './screenShare.js';
import { installPermissionHandlers } from './session.js';
import { launchedAtLogin, startAtLogin } from './startAtLogin.js';
import { stringsFor } from './strings.js';
import { createTray } from './tray.js';

// A development run keeps its own session and window state, and its own
// single-instance lock, so it can run next to an installed Linkord
if (!app.isPackaged) app.setPath('userData', path.join(app.getPath('appData'), 'Linkord Dev'));

// Read only in an installed build: a development run must not pick up the
// address of the last installer built from the same dist/
function bundledUrl(): string | undefined {
  if (!app.isPackaged) return undefined;
  try {
    return parseAppConfig(JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../app-config.json'), 'utf8'))).url;
  } catch {
    return undefined;
  }
}

const resolved = resolveAppUrl({ argv: process.argv, env: process.env, isPackaged: app.isPackaged, bundledUrl: bundledUrl() });

if (!resolved.ok) {
  // Only a misconfigured build gets here: `npm run package` refuses to build without an address
  const detail = resolved.reason === 'missing'
    ? 'This build has no Linkord server address. Set LINKORD_URL or pass --url=<address>.'
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
  let tray: Tray | null = null;
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
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

  app.whenReady().then(() => {
    const strings = stringsFor(app.getPreferredSystemLanguages());
    const loginItem = startAtLogin();
    const actions: MenuActions = {
      showWindow: showMainWindow,
      setStartAtLogin: (enabled) => { loginItem.setEnabled(enabled); refreshMenus(); },
      quit: () => app.quit(),
    };
    const refreshMenus = () => {
      const state = { strings, startAtLogin: { available: loginItem.available, enabled: loginItem.isEnabled() } };
      tray?.setContextMenu(Menu.buildFromTemplate(trayMenuTemplate(state, actions)));
    };
    tray = createTray(showMainWindow);
    refreshMenus();

    const picker = sharePicker({ platform: process.platform, systemVersion: process.getSystemVersion(), env: process.env });
    installPermissionHandlers(session.defaultSession, appUrl.origin);
    installScreenShare(session.defaultSession, appUrl.origin, picker);
    installAppBridge(appUrl.origin);
    mainWindow = createMainWindow({
      appUrl,
      stateFile: path.join(app.getPath('userData'), 'window-state.json'),
      preload: path.join(import.meta.dirname, '../preload/index.cjs'),
      startHidden: launchedAtLogin(),
      preloadArguments: [
        `--linkord-desktop-version=${app.getVersion()}`,
        `--linkord-share-picker=${picker}`,
        `--linkord-system-audio=${capturesSystemAudio(process.platform) ? '1' : '0'}`,
      ],
    });
    // Closing the window only hides it (to the dock on macOS, the tray
    // elsewhere), so a call keeps going; quitting is in the tray and menu
    mainWindow.on('close', (event) => {
      if (quitting) return;
      event.preventDefault();
      mainWindow?.hide();
    });
    // A logout or shutdown closes the window without before-quit: holding it
    // open would hold the system up
    mainWindow.on('session-end', () => { quitting = true; });
    powerMonitor.on('shutdown', () => { quitting = true; app.quit(); });
    mainWindow.on('closed', () => { mainWindow = null; });
  });
}
