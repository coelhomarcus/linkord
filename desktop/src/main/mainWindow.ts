import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BrowserWindow, ipcMain, screen, type IpcMainEvent } from 'electron';
import { connectionView, isScreenFrame, isScreenUrl, parseConnectionAction, type ConnectionScreen } from './connectionScreen.js';
import { SECURE_WEB_PREFERENCES } from './contentsGuard.js';
import { NO_CRASHES, isLoadFailure, isServerReady, pageCrashed, pageLoaded, retryDelayMs } from './loadRetry.js';
import type { Strings } from './strings.js';
import { titleBarOptions, type TitleBarStyle } from './titleBar.js';
import { MIN_SIZE, parseWindowState, placeWindow, type WindowState } from './windowState.js';

// The default theme's shell colour (web/index.html), so the window does not
// flash white before the page paints
const BACKGROUND = '#000000';
const SAVE_DELAY_MS = 500;
const SCREEN_PAGE = path.join(import.meta.dirname, '../../assets/connection.html');
const SCREEN_URL = pathToFileURL(SCREEN_PAGE).href;
// The same names are spelled out in src/preload/index.cts, which cannot import this file
const RENDER = 'linkord:connection:render';
const ACTION = 'linkord:connection:action';
const CHECK_TIMEOUT_MS = 10_000;
// A start that has not heard from the server by then shows the screen meanwhile
const SLOW_CHECK_MS = 1_000;

function readState(file: string): WindowState | null {
  try { return parseWindowState(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { return null; }
}

function writeState(file: string, window: BrowserWindow, maximized: boolean): void {
  const state: WindowState = { bounds: window.getNormalBounds(), maximized };
  try { fs.writeFileSync(file, JSON.stringify(state)); } catch (error) { console.error('[desktop] could not save the window state', error); }
}

export interface MainWindow {
  window: BrowserWindow;
  /** loads another page of the app, with the same retries as the first load */
  load: (url: URL) => void;
  /** shows the window, maximized the first time when it was left that way */
  show: () => void;
  /** "try now" from a screen shown elsewhere (the start's, in the updater window) */
  retry: () => void;
}

/**
 * A start's own window, which shows what the main window would until the
 * app's page has loaded once: the main window stays hidden meanwhile.
 */
export interface StartScreen {
  show(screen: ConnectionScreen): void;
  /** the app's page has loaded: the main window is ready to be shown */
  loaded(): void;
}

export function createMainWindow(options: {
  appUrl: URL;
  /** a page of the app to open first instead of appUrl (a `linkord://` link) */
  startUrl?: URL | null;
  stateFile: string;
  preload: string;
  /** Read by the preload from process.argv: it cannot ask the main process synchronously. */
  preloadArguments: string[];
  /** a start with the system: the window waits in the tray until it is opened */
  startHidden: boolean;
  /** shows the connection while the start's own window is up, and is told when the page has loaded */
  start?: StartScreen;
  strings: Strings;
  /** which system's buttons the page draws; the connecting screen draws the same */
  titleBar: TitleBarStyle;
}): MainWindow {
  const placement = placeWindow(readState(options.stateFile), screen.getAllDisplays().map((d) => d.workArea));
  const window = new BrowserWindow({
    ...placement.bounds,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    title: 'Linkord',
    backgroundColor: BACKGROUND,
    show: false,
    autoHideMenuBar: true,
    ...titleBarOptions(process.platform),
    webPreferences: {
      ...SECURE_WEB_PREFERENCES,
      preload: options.preload,
      spellcheck: true,
      additionalArguments: options.preloadArguments,
    },
  });
  // maximize() also shows a hidden window, which would put the app on screen
  // behind the updater window or at a start in the tray: a window left
  // maximized is maximized as it is first shown instead
  let maximizeOnShow = placement.maximized;
  const showWindow = () => {
    if (window.isDestroyed()) return;
    if (maximizeOnShow) {
      maximizeOnShow = false;
      window.maximize();
      return;
    }
    if (window.isMinimized()) window.restore();
    window.show();
  };
  const saveState = () => writeState(options.stateFile, window, maximizeOnShow || window.isMaximized());

  let start = options.start ?? null;
  // Also once the connecting screen is up, so the retry is not an empty,
  // invisible window; a start with the system keeps quiet until it is opened,
  // and a start with its own window is shown by whoever made it
  const reveal = () => {
    if (options.startHidden || start || window.isDestroyed() || window.isVisible()) return;
    showWindow();
  };
  window.once('ready-to-show', reveal);

  let saveTimer: NodeJS.Timeout | undefined;
  const saveSoon = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveState, SAVE_DELAY_MS);
  };
  window.on('resize', saveSoon);
  window.on('move', saveSoon);
  window.on('close', () => { clearTimeout(saveTimer); saveState(); });

  // The server may be down or mid-deploy when the app starts. The window then
  // shows its own screen (connectionScreen.ts, assets/connection.html) and
  // checks again, 1 to 30 s apart, before loading the page: loading a server
  // that does not answer would show Chromium's error page instead. Until the
  // page has loaded once, a start with its own window shows it there instead.
  const { strings, titleBar } = options;
  const contents = window.webContents;
  let attempt = 0;
  let retryTimer: NodeJS.Timeout | undefined;
  let slowTimer: NodeJS.Timeout | undefined;
  let tickTimer: NodeJS.Timeout | undefined;
  let target = options.startUrl ?? options.appUrl;
  // What the screen shows; null once the app's page is on its way
  let shown: ConnectionScreen | null = null;
  // The screen's page, true once loaded; null when another page replaced it
  let screenPage: Promise<boolean> | null = null;
  // A check that answers after something else happened does nothing
  let turn = 0;

  const render = () => {
    if (start) {
      if (shown) start.show(shown);
      return;
    }
    void screenPage?.then((loaded) => {
      if (!loaded || !shown || window.isDestroyed() || !isScreenUrl(contents.getURL(), SCREEN_URL)) return;
      contents.send(RENDER, connectionView(shown, strings, { now: Date.now(), titleBar, maximized: window.isMaximized() }));
    });
  };
  const show = (next: ConnectionScreen) => {
    shown = next;
    clearInterval(tickTimer);
    if (next.kind === 'waiting') tickTimer = setInterval(render, 1_000);
    if (start) return render();
    // A failure here is another load replacing it, or did-fail-load's to report
    screenPage ??= contents.loadFile(SCREEN_PAGE).then(() => true, () => false);
    render();
  };
  const settle = () => {
    turn++;
    clearTimeout(retryTimer);
    clearTimeout(slowTimer);
  };
  const loadApp = () => {
    settle();
    shown = null;
    screenPage = null;
    clearInterval(tickTimer);
    contents.loadURL(target.href).catch(() => {
      // did-fail-load reports the failure and schedules the retry
    });
  };
  const serverReady = async () => {
    try {
      const response = await contents.session.fetch(options.appUrl.href, { cache: 'no-store', signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) });
      await response.body?.cancel();
      return isServerReady(response.status);
    } catch {
      return false;
    }
  };
  const connect = () => {
    settle();
    const own = turn;
    // A start shows nothing until the check answers, unless it is slow
    if (screenPage || start) show({ kind: 'connecting' });
    else slowTimer = setTimeout(() => show({ kind: 'connecting' }), SLOW_CHECK_MS);
    void serverReady().then((ready) => {
      if (own !== turn || window.isDestroyed()) return;
      if (ready) loadApp();
      else scheduleRetry('no answer');
    });
  };
  const scheduleRetry = (reason: string) => {
    settle();
    const delay = retryDelayMs(attempt++);
    console.warn(`[desktop] could not load ${options.appUrl.origin} (${reason}); retrying in ${delay} ms`);
    retryTimer = setTimeout(connect, delay);
    show({ kind: 'waiting', retryAt: Date.now() + delay });
  };

  contents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isLoadFailure(errorCode, isMainFrame)) return;
    if (isScreenUrl(validatedURL, SCREEN_URL)) {
      // Only a broken build: the retries go on behind whatever shows instead
      console.error(`[desktop] could not show the connecting screen (${errorDescription})`);
      screenPage = null;
      reveal();
      return;
    }
    scheduleRetry(errorDescription);
  });
  let crashes = NO_CRASHES;
  contents.on('did-finish-load', () => {
    if (isScreenUrl(contents.getURL(), SCREEN_URL)) {
      reveal();
      // Also after a reload from the menu, which starts the page over
      render();
      return;
    }
    attempt = 0;
    crashes = pageLoaded(crashes, Date.now());
    const started = start;
    start = null;
    started?.loaded();
  });
  contents.on('render-process-gone', (_event, details) => {
    screenPage = null;
    if (details.reason === 'clean-exit') return;
    const result = pageCrashed(crashes, Date.now());
    crashes = result.history;
    settle();
    if (result.decision.kind === 'give-up') {
      console.error(`[desktop] page process gone (${details.reason}) too many times in a row; stopped`);
      show({ kind: 'crashed' });
      return;
    }
    const { delayMs } = result.decision;
    console.error(`[desktop] page process gone (${details.reason}); reloading in ${delayMs} ms`);
    retryTimer = setTimeout(connect, delayMs);
  });

  const retry = () => {
    if (shown && shown.kind !== 'connecting') connect();
  };

  // The screen's only messages: try now, and the window's own buttons
  const onAction = (event: IpcMainEvent, value: unknown) => {
    if (event.sender !== contents || !isScreenFrame(event.senderFrame, SCREEN_URL)) return;
    switch (parseConnectionAction(value)) {
      case 'retry':
        retry();
        return;
      case 'minimize':
        window.minimize();
        return;
      case 'toggle-maximize':
        if (window.isMaximized()) window.unmaximize();
        else window.maximize();
        return;
      // The window's close handler decides what closing means (hide to the tray)
      case 'close':
        window.close();
        return;
    }
  };
  ipcMain.on(ACTION, onAction);
  window.on('maximize', render);
  window.on('unmaximize', render);
  window.on('closed', () => {
    settle();
    clearInterval(tickTimer);
    clearTimeout(saveTimer);
    ipcMain.removeListener(ACTION, onAction);
  });

  connect();
  return {
    window,
    load: (url) => {
      target = url;
      attempt = 0;
      // On the screen, check first, as a retry would
      if (shown) connect();
      else loadApp();
    },
    show: showWindow,
    retry,
  };
}
