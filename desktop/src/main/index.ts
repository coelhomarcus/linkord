import fs from 'node:fs';
import path from 'node:path';
import { Menu, app, dialog, powerMonitor, session, shell, type BrowserWindow, type Tray } from 'electron';
import { installActivityBridge, sendActivity } from './activityBridge.js';
import { createActivityWatcher } from './activityWatcher.js';
import { forwardWindowState, installAppBridge } from './appBridge.js';
import { parseAppConfig, resolveAppUrl } from './appUrl.js';
import { guardContents } from './contentsGuard.js';
import { forbiddenSwitch } from './debugSwitches.js';
import { deepLinkFromArgv, deepLinkPath, protocolRegistration } from './deepLink.js';
import { installDeepLinkBridge } from './deepLinkBridge.js';
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
import type { UpdaterAction } from './updaterScreen.js';
import { createUpdaterWindow } from './updaterWindow.js';
import { INSTALL_DELAY_MS, INSTALL_FALLBACK_MS, RESULT_LINGER_MS, STARTUP_CHECK_TIMEOUT_MS, checksAtStart, mainWindowMayShow, updateMode, updaterMayClose, type StartupPhase } from './updates.js';

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
  let mainWindow: BrowserWindow | null = null;
  let tray: Tray | null = null;
  let quitting = false;

  // The start's update check holds the app's window back (updates.ts)
  let startupPhase: StartupPhase = 'open';
  let focusUpdater = () => {};
  const showMainWindow = () => {
    if (!mainWindowMayShow(startupPhase)) return focusUpdater();
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  };

  if (process.platform === 'win32') app.setAppUserModelId('app.linkord.desktop');

  // `linkord://` links (deepLink.ts). One that started the app is the first
  // page it loads; later ones reach this instance through second-instance
  // (Windows, Linux) or open-url (macOS)
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
  app.on('open-url', (event, link) => {
    event.preventDefault();
    followLink(deepLinkPath(link));
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
    let startupSettled: ((showApp: boolean) => void) | null = null;
    const installNow = () => {
      if (updater.status().kind !== 'downloaded') return;
      turn++;
      followProgress = false;
      clearTimeout(lingerTimer);
      updaterWindow?.show({ kind: 'installing' });
      setTimeout(() => updater.apply(), updaterWindow ? INSTALL_DELAY_MS : 0);
    };
    const onUpdaterAction = (action: UpdaterAction) => {
      if (action === 'restart') return installNow();
      turn++;
      followProgress = false;
      clearTimeout(lingerTimer);
      updaterWindow?.close();
      startupSettled?.(true);
      startupSettled = null;
    };
    const updaterWindow = updater.mode === 'install'
      ? createUpdaterWindow(strings, onUpdaterAction, () => updaterMayClose({ phase: startupPhase, quitting }))
      : null;
    focusUpdater = () => updaterWindow?.focus();
    const timedOut = Symbol('timed out');
    /** The timeout only bounds the question; an update found is waited for until it is downloaded. */
    const findAndDownload = async (timeoutMs?: number, onFound?: () => void): Promise<'none' | 'failed' | 'ready' | typeof timedOut> => {
      const status = updater.status();
      if (status.kind === 'downloaded') return 'ready';
      if (status.kind === 'idle') {
        const outcome = await (timeoutMs === undefined ? updater.check() : Promise.race([
          updater.check(),
          new Promise<typeof timedOut>((resolve) => setTimeout(() => resolve(timedOut), timeoutMs)),
        ]));
        if (outcome === timedOut) return timedOut;
        if (outcome.kind !== 'update') return outcome.kind === 'failed' ? 'failed' : 'none';
      }
      onFound?.();
      return (await updater.download()) ? 'ready' : 'failed';
    };
    // As Discord does: a start shows the check, and an update found is
    // downloaded and installed before the app opens, with the updater window
    // on screen until the installer takes over. A slow, failed or empty check
    // only opens the app.
    const startupCheck = () => new Promise<boolean>((resolve) => {
      const own = ++turn;
      startupPhase = 'checking';
      const open = () => {
        startupSettled = null;
        startupPhase = 'open';
        resolve(true);
      };
      startupSettled = open;
      followProgress = true;
      updaterWindow?.show({ kind: 'checking' });
      const found = () => { if (own === turn) startupPhase = 'updating'; };
      void findAndDownload(STARTUP_CHECK_TIMEOUT_MS, found).then((result) => {
        if (own !== turn) return;
        if (result === 'ready') {
          startupSettled = null;
          installNow();
          // The installer quits the app; if it never does, the app still opens
          setTimeout(() => {
            if (startupPhase !== 'updating') return;
            console.error('[desktop] the update did not install; opening the app');
            updaterWindow?.close();
            open();
            showMainWindow();
          }, INSTALL_FALLBACK_MS).unref();
          return;
        }
        followProgress = false;
        updaterWindow?.close();
        open();
      });
    });
    const checkFromMenu = () => {
      if (!updaterWindow) return;
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
      const status = updater.status();
      if (followProgress && status.kind === 'downloading') updaterWindow?.show({ kind: 'downloading', version: status.version, percent: status.percent });
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
      applyUpdate: installNow,
    });
    const startHidden = launchedAtLogin() && preferences.startMinimized;
    const showWhen = checksAtStart({ mode: updater.mode, startHidden }) ? startupCheck() : undefined;
    const main = createMainWindow({
      appUrl,
      startUrl: pendingLink ? new URL(pendingLink, appUrl.origin) : null,
      stateFile: path.join(app.getPath('userData'), 'window-state.json'),
      preload: path.join(import.meta.dirname, '../preload/index.cjs'),
      startHidden,
      showWhen,
      strings,
      titleBar: barStyle,
      preloadArguments: [
        `--linkord-desktop-version=${app.getVersion()}`,
        `--linkord-share-picker=${picker}`,
        `--linkord-system-audio=${capturesSystemAudio(process.platform) ? '1' : '0'}`,
        `--linkord-title-bar=${barStyle}`,
      ],
    });
    mainWindow = main.window;
    pendingLink = null;
    openLink = installDeepLinkBridge(main, appUrl.origin);
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
    mainWindow.on('closed', () => { mainWindow = null; openLink = null; });
  });
}
