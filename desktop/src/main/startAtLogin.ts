import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import { HIDDEN_FLAG, linuxAutostartEntry, linuxAutostartFile, linuxExecutable, startedHidden } from './loginItem.js';

export interface StartAtLogin {
  /** false in a development run, which would register the bare Electron binary */
  readonly available: boolean;
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
}

// Windows matches the login item by its arguments, so reads pass the same ones
const LOGIN_ARGS = [HIDDEN_FLAG];

function linuxStartAtLogin(): StartAtLogin {
  const file = linuxAutostartFile(process.env, os.homedir());
  return {
    available: true,
    isEnabled: () => fs.existsSync(file),
    setEnabled(enabled) {
      try {
        if (enabled) {
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, linuxAutostartEntry(linuxExecutable(process.env, process.execPath)));
        } else {
          fs.rmSync(file, { force: true });
        }
      } catch (error) {
        console.error('[desktop] could not change the autostart entry', error);
      }
    },
  };
}

export function startAtLogin(): StartAtLogin {
  if (!app.isPackaged) return { available: false, isEnabled: () => false, setEnabled: () => {} };
  if (process.platform === 'linux') return linuxStartAtLogin();
  return {
    available: true,
    isEnabled: () => app.getLoginItemSettings({ args: LOGIN_ARGS }).openAtLogin,
    setEnabled: (enabled) => app.setLoginItemSettings({ openAtLogin: enabled, args: LOGIN_ARGS }),
  };
}

export function launchedAtLogin(): boolean {
  // wasOpenedAtLogin is macOS only; the other systems pass HIDDEN_FLAG
  const wasOpenedAtLogin = process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin;
  return startedHidden({ argv: process.argv, wasOpenedAtLogin });
}
