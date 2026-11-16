import fs from 'node:fs';
import path from 'node:path';
import { Menu, app, dialog, powerMonitor, session, shell, type BrowserWindow, type Tray } from 'electron';
import { installActivityBridge, sendActivity } from './activityBridge.js';
import { createActivityWatcher } from './activityWatcher.js';
import { forwardWindowState, installAppBridge } from './appBridge.js';
import { parseAppConfig, resolveAppUrl } from './appUrl.js';
import { guardContents } from './contentsGuard.js';
import { capturesSystemAudio, sharePicker } from './displayMedia.js';
import { createMainWindow } from './mainWindow.js';
import { appMenuTemplate, runTrayItem, trayMenuItems, trayMenuTemplate, type MenuActions, type MenuState } from './menus.js';
import { installScreenShare } from './screenShare.js';
import { installPermissionHandlers } from './session.js';
import { installSettingsBridge, loadPreferences, savePreferences, sendSettings, type DesktopSettings, type SettingsChange } from './settingsBridge.js';
import { launchedAtLogin, startAtLogin } from './startAtLogin.js';
import { format, stringsFor } from './strings.js';
import { titleBarStyle } from './titleBar.js';
import { createTray } from './tray.js';
import { drawsTrayMenu } from './trayMenuLayout.js';
import { createTrayMenuWindow } from './trayMenuWindow.js';
import { installUpdater } from './updater.js';
import { updateMode } from './updates.js';

// A development run keeps its own session and window state, and its own
// single-instance lock, so it can run next to an installed Linkord
if (!app.isPackaged) app.setPath('userData', path.join(app.getPath('appData'), 'Linkord Dev'));

// Read only in an installed build: a development run must not pick up the
// address (or update source) of the last installer built from the same dist/
function bundledConfig(): ReturnType<typeof parseAppConfig> {
  if (!app.isPackaged) return {};
  try {
    return parseAppConfig(JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../app-config.json'), 'utf8')));
  } catch {
    return {};
  }
}

const config = bundledConfig();
const resolved = resolveAppUrl({ argv: process.argv, env: process.env, isPackaged: app.isPackaged, bundledUrl: config.url });

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
    const preferencesFile = path.join(app.getPath('userData'), 'preferences.json');
    let preferences = loadPreferences(preferencesFile);
    const repo = config.updateRepo ?? null;
    const updater = installUpdater({
      mode: updateMode({ platform: process.platform, isPackaged: app.isPackaged, repo, appImage: process.env.APPIMAGE }),
      repo,
      currentVersion: app.getVersion(),
      strings,
      onChange: () => refresh(),
    });
    const settings = (): DesktopSettings => ({
      ...preferences,
      version: app.getVersion(),
      startAtLogin: { available: loginItem.available, enabled: loginItem.isEnabled() },
      update: { mode: updater.mode, status: updater.status() },
    });
    const changeSettings = (change: SettingsChange) => {
      const { startAtLogin: login, ...rest } = change;
      if (login !== undefined && loginItem.available) loginItem.setEnabled(login);
      if (Object.keys(rest).length > 0) {
        preferences = { ...preferences, ...rest };
        savePreferences(preferencesFile, preferences);
      }
      refresh();
    };
    // From the menu the answer is a dialog; the settings page shows its own
    const checkFromMenu = () => {
      void updater.check().then((outcome) => {
        const message = outcome.kind === 'up-to-date' ? format(strings.updateUpToDate, { version: app.getVersion() })
          : outcome.kind === 'failed' ? strings.updateFailed
            : null;
        if (message) dialog.showMessageBox({ type: 'info', message, buttons: [strings.ok] }).catch(() => {});
      });
    };
    const actions: MenuActions = {
      showWindow: showMainWindow,
      setStartAtLogin: (enabled) => changeSettings({ startAtLogin: enabled }),
      checkForUpdates: checkFromMenu,
      applyUpdate: () => updater.apply(),
      openInBrowser: () => { shell.openExternal(appUrl.href).catch((error: unknown) => console.error('[desktop] could not open the browser', error)); },
      quit: () => app.quit(),
    };
    const menuState = (): MenuState => ({
      platform: process.platform,
      strings,
      startAtLogin: { available: loginItem.available, enabled: loginItem.isEnabled() },
      update: { mode: updater.mode, status: updater.status() },
      devTools: !app.isPackaged,
    });
    const drawnMenu = drawsTrayMenu({ platform: process.platform, env: process.env, isPackaged: app.isPackaged })
      ? createTrayMenuWindow((id, checked) => runTrayItem(menuState(), actions, id, checked))
      : null;
    const refresh = () => {
      const state = menuState();
      Menu.setApplicationMenu(Menu.buildFromTemplate(appMenuTemplate(state, actions)));
      if (!drawnMenu) tray?.setContextMenu(Menu.buildFromTemplate(trayMenuTemplate(state, actions)));
      sendSettings(mainWindow, settings());
    };
    tray = createTray(showMainWindow, drawnMenu && (() => {
      void drawnMenu.show({ title: 'Linkord', version: format(strings.version, { version: app.getVersion() }), items: trayMenuItems(menuState()) });
    }));
    refresh();

    const barStyle = titleBarStyle({ platform: process.platform, env: process.env, isPackaged: app.isPackaged });
    const picker = sharePicker({ platform: process.platform, systemVersion: process.getSystemVersion(), env: process.env });
    installPermissionHandlers(session.defaultSession, appUrl.origin);
    installScreenShare(session.defaultSession, appUrl.origin, picker);
    installAppBridge(appUrl.origin);
    const activityWatcher = createActivityWatcher({
      recentFile: path.join(app.getPath('userData'), 'activity-recent.json'),
      onChange: (activity) => sendActivity(mainWindow, activity),
    });
    installActivityBridge(appUrl.origin, activityWatcher);
    installSettingsBridge(appUrl.origin, {
      read: settings,
      change: changeSettings,
      checkForUpdates: () => updater.check(),
      applyUpdate: () => updater.apply(),
    });
    mainWindow = createMainWindow({
      appUrl,
      stateFile: path.join(app.getPath('userData'), 'window-state.json'),
      preload: path.join(import.meta.dirname, '../preload/index.cjs'),
      startHidden: launchedAtLogin() && preferences.startMinimized,
      preloadArguments: [
        `--linkord-desktop-version=${app.getVersion()}`,
        `--linkord-share-picker=${picker}`,
        `--linkord-system-audio=${capturesSystemAudio(process.platform) ? '1' : '0'}`,
        `--linkord-title-bar=${barStyle}`,
      ],
    });
    // Previewing another system's bar on a Mac: its buttons replace the traffic lights
    if (process.platform === 'darwin' && barStyle !== 'mac') mainWindow.setWindowButtonVisibility(false);
    forwardWindowState(mainWindow);
    // Closing the window only hides it (to the tray, the menu bar and dock
    // on macOS), so a call keeps going; quitting is in the tray and menu.
    // Turned off in settings, closing quits.
    mainWindow.on('close', (event) => {
      if (quitting) return;
      event.preventDefault();
      if (preferences.closeToTray) mainWindow?.hide();
      else app.quit();
    });
    // A logout or shutdown closes the window without before-quit: holding it
    // open would hold the system up
    mainWindow.on('session-end', () => { quitting = true; });
    powerMonitor.on('shutdown', () => { quitting = true; app.quit(); });
    mainWindow.on('closed', () => { mainWindow = null; });
  });
}
