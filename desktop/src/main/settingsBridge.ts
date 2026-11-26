import fs from 'node:fs';
import { BrowserWindow, ipcMain } from 'electron';
import { isAppPage } from './appPage.js';
import { parsePreferenceChange, parsePreferences, type DesktopPreferences } from './preferences.js';
import type { UpdateCheckOutcome, UpdateMode, UpdateStatus } from './updates.js';

// The same names are spelled out in src/preload/index.cts, which cannot import this file
const GET = 'overcord:settings:get';
const SET = 'overcord:settings:set';
const CHECK_UPDATES = 'overcord:settings:check-updates';
const APPLY_UPDATE = 'overcord:settings:apply-update';
const CHANGED = 'overcord:settings:changed';

/** What the settings page shows. */
export interface DesktopSettings extends DesktopPreferences {
  version: string;
  startAtLogin: { available: boolean; enabled: boolean };
  update: { mode: UpdateMode; status: UpdateStatus };
}

export interface SettingsChange extends Partial<DesktopPreferences> {
  startAtLogin?: boolean;
}

export function loadPreferences(file: string): DesktopPreferences {
  try { return parsePreferences(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { return parsePreferences(null); }
}

export function savePreferences(file: string, preferences: DesktopPreferences): void {
  try { fs.writeFileSync(file, JSON.stringify(preferences)); } catch (error) { console.error('[desktop] could not save the preferences', error); }
}

export function installSettingsBridge(appOrigin: string, handlers: {
  read(): DesktopSettings;
  change(change: SettingsChange): void;
  checkForUpdates(): Promise<UpdateCheckOutcome>;
  applyUpdate(): void;
}): void {
  ipcMain.handle(GET, (event) => (isAppPage(event.senderFrame, appOrigin) ? handlers.read() : null));
  ipcMain.handle(SET, (event, raw: unknown) => {
    if (!isAppPage(event.senderFrame, appOrigin)) return null;
    const startAtLogin = raw && typeof raw === 'object' ? (raw as { startAtLogin?: unknown }).startAtLogin : undefined;
    handlers.change({ ...parsePreferenceChange(raw), ...(typeof startAtLogin === 'boolean' ? { startAtLogin } : {}) });
    return handlers.read();
  });
  ipcMain.handle(CHECK_UPDATES, (event) => (isAppPage(event.senderFrame, appOrigin) ? handlers.checkForUpdates() : { kind: 'off' }));
  ipcMain.handle(APPLY_UPDATE, (event) => { if (isAppPage(event.senderFrame, appOrigin)) handlers.applyUpdate(); });
}

/** Keeps an open settings page in step with the tray and the menu. */
export function sendSettings(window: BrowserWindow | null, settings: DesktopSettings): void {
  if (window && !window.isDestroyed()) window.webContents.send(CHANGED, settings);
}
