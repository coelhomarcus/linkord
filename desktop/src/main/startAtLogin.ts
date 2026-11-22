import { app } from 'electron';
import { HIDDEN_FLAG, startedHidden } from './loginItem.js';

export interface StartAtLogin {
  /** false in a development run, which would register the bare Electron binary */
  readonly available: boolean;
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
}

// Windows matches the login item by its arguments, so reads pass the same ones
const LOGIN_ARGS = [HIDDEN_FLAG];

export function startAtLogin(): StartAtLogin {
  if (!app.isPackaged) return { available: false, isEnabled: () => false, setEnabled: () => {} };
  return {
    available: true,
    isEnabled: () => app.getLoginItemSettings({ args: LOGIN_ARGS }).openAtLogin,
    setEnabled: (enabled) => app.setLoginItemSettings({ openAtLogin: enabled, args: LOGIN_ARGS }),
  };
}

export function launchedAtLogin(): boolean {
  return startedHidden(process.argv);
}
