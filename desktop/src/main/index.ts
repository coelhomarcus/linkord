import fs from 'node:fs';
import path from 'node:path';
import { Menu, app, dialog, powerMonitor, session, shell, type BrowserWindow, type Tray } from 'electron';
import { installActivityBridge, sendActivity, sendRunningActivities } from './activityBridge.js';
import { createActivityWatcher } from './activityWatcher.js';
import { forwardWindowState, installAppBridge } from './appBridge.js';
import { parseAppConfig, resolveAppUrl } from './appUrl.js';
import { guardContents } from './contentsGuard.js';
import { forbiddenSwitch } from './debugSwitches.js';
import { deepLinkFromArgv, protocolRegistration } from './deepLink.js';
import { installDeepLinkBridge } from './deepLinkBridge.js';
import { installNotificationBridge } from './notificationBridge.js';
import { capturesSystemAudio } from './displayMedia.js';
import { createMainWindow, type MainWindow } from './mainWindow.js';
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
import { startScreen, type UpdaterAction } from './updaterScreen.js';
import { createUpdaterWindow } from './updaterWindow.js';
import { INSTALL_DELAY_MS, INSTALL_FALLBACK_MS, RESULT_LINGER_MS, STARTUP_CHECK_TIMEOUT_MS, checksAtStart, mainWindowMayShow, startWindowClose, updateMode, type StartupPhase } from './updates.js';

const debugSwitch = forbiddenSwitch({ isPackaged: app.isPackaged, hasSwitch: (name) => app.commandLine.hasSwitch(name) });
if (debugSwitch) {
  console.error(`[desktop] refusing to start with --${debugSwitch}`);
  app.exit(1);
}

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
  let main: MainWindow | null = null;
  let mainWindow: BrowserWindow | null = null;
  let tray: Tray | null = null;
  let quitting = false;

  // A start shows only the updater window until the app's page has loaded (updates.ts)
  let startupPhase: StartupPhase = 'open';
  let focusUpdater = () => {};
  const showMainWindow = () => {
    if (!mainWindowMayShow(startupPhase)) return focusUpdater();
    if (!main || !mainWindow) return;
    main.show();
    mainWindow.focus();
  };

  if (process.platform === 'win32') app.setAppUserModelId('app.linkord.desktop');

  // `linkord://` links (deepLink.ts). One that started the app is the first
  // page it loads; later ones reach this instance through second-instance
  const registration = protocolRegistration({
    isPackaged: app.isPackaged,
    defaultApp: process.defaultApp === true,
    argv: process.argv,
    execPath: process.execPath,
    resolvePath: (value) => path.resolve(value),
  });
  if (registration && !app.setAsDefaultProtocolClient(registration.scheme, registration.path, registration.args)) {
    console.warn(`[desktop] could not register ${registration.scheme}://`);
  }
  let pendingLink = deepLinkFromArgv(process.argv);
  let openLink: ((path: string) => void) | null = null;
  const followLink = (path: string | null) => {
    if (!path) return;
    if (!openLink) { pendingLink = path; return; }
    showMainWindow();
    openLink(path);
  };

  app.on('web-contents-created', (_event, contents) => guardContents(contents, appUrl.origin));
  app.on('second-instance', (_event, argv) => {
    showMainWindow();
    followLink(deepLinkFromArgv(argv));
  });
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
      mode: updateMode({ platform: process.platform, isPackaged: app.isPackaged, repo }),
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

    // The updater window follows one check at a time: the start's, or one
    // asked for from the tray or the menu (the settings page shows its own).
    // Each takes a new turn, and closing the window ends the turn, so a check
    // that settles after that shows nothing.
    let turn = 0;
    let followProgress = false;
    let lingerTimer: NodeJS.Timeout | undefined;
    const installNow = () => {
      if (updater.status().kind !== 'downloaded') return;
      turn++;
      followProgress = false;
      clearTimeout(lingerTimer);
      updaterWindow.show({ kind: 'installing' });
      setTimeout(() => updater.apply(), INSTALL_DELAY_MS);
    };
    const onUpdaterAction = (action: UpdaterAction) => {
      if (action === 'restart') return installNow();
      if (action === 'retry') return main?.retry();
      if (startWindowClose({ phase: startupPhase, quitting }) === 'quit') return app.quit();
      turn++;
      followProgress = false;
      clearTimeout(lingerTimer);
      updaterWindow.close();
    };
    const updaterWindow = createUpdaterWindow(strings, onUpdaterAction, () => startWindowClose({ phase: startupPhase, quitting }) !== 'refuse');
    focusUpdater = () => updaterWindow.focus();
    /** An update found is downloaded before this settles. */
    const findAndDownload = async (onFound?: () => void): Promise<'none' | 'failed' | 'ready'> => {
      const status = updater.status();
      if (status.kind === 'downloaded') return 'ready';
      if (status.kind === 'idle') {
        const outcome = await updater.check();
        if (outcome.kind !== 'update') return outcome.kind === 'failed' ? 'failed' : 'none';
      }
      onFound?.();
      return (await updater.download()) ? 'ready' : 'failed';
    };
    // As Discord does: a start shows the check, and an update found is
    // downloaded and installed before the app opens, with the updater window
    // on screen until the installer takes over. A failed or empty check goes
    // on to the connection, and so does a slow one, but an update it still
    // finds before the app's window opens is installed first.
    const startUp = () => {
      if (!checksAtStart({ mode: updater.mode, startHidden })) return connectApp();
      const own = ++turn;
      startupPhase = 'checking';
      followProgress = true;
      updaterWindow.show({ kind: 'checking' });
      const slow = setTimeout(() => {
        if (own === turn && startupPhase === 'checking') connectApp();
      }, STARTUP_CHECK_TIMEOUT_MS);
      const found = () => {
        // Once the app is open, the download goes on in the background as any other
        if (own !== turn || startupPhase === 'open') return;
        if (startupPhase === 'connecting') discardApp();
        startupPhase = 'updating';
        followProgress = true;
        refresh();
      };
      void findAndDownload(found).then((result) => {
        clearTimeout(slow);
        if (own !== turn) return;
        if (startupPhase === 'checking') return connectApp();
        if (startupPhase !== 'updating') return;
        if (result !== 'ready') return connectApp();
        installNow();
        // The installer quits the app; if it never does, the app still opens
        setTimeout(() => {
          if (startupPhase !== 'updating') return;
          console.error('[desktop] the update did not install; opening the app');
          connectApp();
        }, INSTALL_FALLBACK_MS).unref();
      });
    };
    const checkFromMenu = () => {
      if (updater.mode !== 'install') return;
      // The start's own check is on screen already
      if (startupPhase !== 'open') return focusUpdater();
      const own = ++turn;
      clearTimeout(lingerTimer);
      followProgress = true;
      updaterWindow.show({ kind: 'checking' });
      void findAndDownload().then((result) => {
        if (own !== turn) return;
        followProgress = false;
        const status = updater.status();
        if (result === 'ready' && status.kind === 'downloaded') return updaterWindow.show({ kind: 'ready', version: status.version });
        if (result === 'failed') return updaterWindow.show({ kind: 'failed' });
        updaterWindow.show({ kind: 'up-to-date', version: app.getVersion() });
        lingerTimer = setTimeout(() => { if (own === turn) onUpdaterAction('later'); }, RESULT_LINGER_MS);
      });
    };
    const actions: MenuActions = {
      showWindow: showMainWindow,
      setStartAtLogin: (enabled) => changeSettings({ startAtLogin: enabled }),
      checkForUpdates: checkFromMenu,
      applyUpdate: installNow,
      openInBrowser: () => { shell.openExternal(appUrl.href).catch((error: unknown) => console.error('[desktop] could not open the browser', error)); },
      quit: () => app.quit(),
    };
    const menuState = (): MenuState => ({
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
      const status = updater.status();
      if (followProgress && status.kind === 'downloading') updaterWindow.show({ kind: 'downloading', version: status.version, percent: status.percent });
    };
    tray = createTray(showMainWindow, drawnMenu && (() => {
      void drawnMenu.show({ title: 'Linkord', version: format(strings.version, { version: app.getVersion() }), items: trayMenuItems(menuState()) });
    }));
    refresh();

    const barStyle = titleBarStyle({ platform: process.platform, env: process.env, isPackaged: app.isPackaged });
    installPermissionHandlers(session.defaultSession, appUrl.origin);
    installScreenShare(session.defaultSession, appUrl.origin);
    installAppBridge(appUrl.origin);
    installNotificationBridge(appUrl.origin);
    const activityWatcher = createActivityWatcher({
      recentFile: path.join(app.getPath('userData'), 'activity-recent.json'),
      preferredFile: path.join(app.getPath('userData'), 'activity-preferred.json'),
      onChange: (activity) => sendActivity(mainWindow, activity),
      onRunningChange: (running) => sendRunningActivities(mainWindow, running),
    });
    installActivityBridge(appUrl.origin, activityWatcher);
    installSettingsBridge(appUrl.origin, {
      read: settings,
      change: changeSettings,
      checkForUpdates: () => updater.check(),
      applyUpdate: installNow,
    });
    const startHidden = launchedAtLogin() && preferences.startMinimized;
    const connectApp = () => {
      followProgress = false;
      startupPhase = 'connecting';
      updaterWindow.show({ kind: 'connecting' });
      openApp(true);
    };
    /** An update found while the app's page loads hidden: that window will not be shown. */
    const discardApp = () => {
      const window = mainWindow;
      main = null;
      mainWindow = null;
      openLink = null;
      window?.destroy();
    };
    const finishStart = () => {
      startupPhase = 'open';
      showMainWindow();
      updaterWindow.close();
    };
    const openApp = (start: boolean) => {
      const created = createMainWindow({
        appUrl,
        startUrl: pendingLink ? new URL(pendingLink, appUrl.origin) : null,
        stateFile: path.join(app.getPath('userData'), 'window-state.json'),
        preload: path.join(import.meta.dirname, '../preload/index.cjs'),
        startHidden,
        start: start ? { show: (screen) => updaterWindow.show(startScreen(screen, Date.now())), loaded: finishStart } : undefined,
        strings,
        titleBar: barStyle,
        preloadArguments: [
          `--linkord-desktop-version=${app.getVersion()}`,
          `--linkord-system-audio=${capturesSystemAudio(process.platform) ? '1' : '0'}`,
          `--linkord-title-bar=${barStyle}`,
        ],
      });
      const window = created.window;
      main = created;
      mainWindow = window;
      pendingLink = null;
      openLink = installDeepLinkBridge(created, appUrl.origin);
      // Previewing another system's bar on a Mac: its buttons replace the traffic lights
      if (process.platform === 'darwin' && barStyle !== 'mac') window.setWindowButtonVisibility(false);
      forwardWindowState(window);
      // Closing the window only hides it (to the tray), so a call keeps going;
      // quitting is in the tray and menu.
      // Turned off in settings, closing quits.
      window.on('close', (event) => {
        if (quitting) return;
        event.preventDefault();
        if (preferences.closeToTray) window.hide();
        else app.quit();
      });
      // In a call the page holds itself open with beforeunload, which in Electron
      // silently cancels the close and with it the quit. Quitting overrides it:
      // the page's pagehide still leaves the call on the way out.
      window.webContents.on('will-prevent-unload', (event) => {
        if (quitting) event.preventDefault();
      });
      // A logout or shutdown closes the window without before-quit: holding it
      // open would hold the system up
      window.on('session-end', () => { quitting = true; });
      window.on('closed', () => {
        if (mainWindow !== window) return;
        main = null;
        mainWindow = null;
        openLink = null;
      });
    };
    powerMonitor.on('shutdown', () => { quitting = true; app.quit(); });

    // Every start that opens a window shows only the updater window, through
    // the update check and then the connection, and the app's window once its
    // page has loaded. A start with the system that stays in the tray loads
    // the page hidden and checks for updates in the background.
    if (startHidden) openApp(false);
    else startUp();
  });
}
