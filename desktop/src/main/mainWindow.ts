import fs from 'node:fs';
import { BrowserWindow, screen } from 'electron';
import { SECURE_WEB_PREFERENCES } from './contentsGuard.js';
import { isLoadFailure, retryDelayMs } from './loadRetry.js';
import { MIN_SIZE, parseWindowState, placeWindow, type WindowState } from './windowState.js';

// The default theme's shell colour (web/index.html), so the window does not
// flash white before the page paints
const BACKGROUND = '#000000';
const SAVE_DELAY_MS = 500;

function readState(file: string): WindowState | null {
  try { return parseWindowState(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { return null; }
}

function writeState(file: string, window: BrowserWindow): void {
  const state: WindowState = { bounds: window.getNormalBounds(), maximized: window.isMaximized() };
  try { fs.writeFileSync(file, JSON.stringify(state)); } catch (error) { console.error('[desktop] could not save the window state', error); }
}

export function createMainWindow(options: {
  appUrl: URL;
  stateFile: string;
  preload: string;
  /** Read by the preload from process.argv: it cannot ask the main process synchronously. */
  preloadArguments: string[];
  /** a start with the system: the window waits in the tray until it is opened */
  startHidden: boolean;
}): BrowserWindow {
  const placement = placeWindow(readState(options.stateFile), screen.getAllDisplays().map((d) => d.workArea));
  const window = new BrowserWindow({
    ...placement.bounds,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    title: 'Linkord',
    backgroundColor: BACKGROUND,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      ...SECURE_WEB_PREFERENCES,
      preload: options.preload,
      spellcheck: true,
      additionalArguments: options.preloadArguments,
    },
  });
  if (placement.maximized) window.maximize();

  // Also on a failed load, so the retry is not an empty, invisible window;
  // a start with the system keeps quiet until the person opens it
  const reveal = () => { if (!options.startHidden && !window.isVisible()) window.show(); };
  window.once('ready-to-show', reveal);

  let saveTimer: NodeJS.Timeout | undefined;
  const saveSoon = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => writeState(options.stateFile, window), SAVE_DELAY_MS);
  };
  window.on('resize', saveSoon);
  window.on('move', saveSoon);
  window.on('close', () => { clearTimeout(saveTimer); writeState(options.stateFile, window); });

  // The server may be down or mid-deploy when the app starts: keep retrying
  // instead of leaving an empty window behind
  const contents = window.webContents;
  let attempt = 0;
  let retryTimer: NodeJS.Timeout | undefined;
  const load = () => {
    contents.loadURL(options.appUrl.href).catch(() => {
      // did-fail-load reports the failure and schedules the retry
    });
  };
  contents.on('did-fail-load', (_event, errorCode, errorDescription, _url, isMainFrame) => {
    if (!isLoadFailure(errorCode, isMainFrame)) return;
    reveal();
    const delay = retryDelayMs(attempt++);
    console.warn(`[desktop] could not load ${options.appUrl.origin} (${errorDescription}); retrying in ${delay} ms`);
    clearTimeout(retryTimer);
    retryTimer = setTimeout(load, delay);
  });
  contents.on('did-finish-load', () => { attempt = 0; });
  contents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit') return;
    console.error(`[desktop] page process gone (${details.reason}); reloading`);
    load();
  });
  window.on('closed', () => { clearTimeout(retryTimer); clearTimeout(saveTimer); });

  load();
  return window;
}
