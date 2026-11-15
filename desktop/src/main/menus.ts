import type { MenuItemConstructorOptions } from 'electron';
import type { Strings } from './strings.js';

// Menu templates as plain data, so what each menu offers is tested without
// Electron; index.ts builds them again whenever the state changes.

export interface MenuState {
  strings: Strings;
  startAtLogin: { available: boolean; enabled: boolean };
}

export interface MenuActions {
  showWindow(): void;
  setStartAtLogin(enabled: boolean): void;
  quit(): void;
}

function startAtLoginItems(state: MenuState, actions: MenuActions): MenuItemConstructorOptions[] {
  if (!state.startAtLogin.available) return [];
  return [{
    label: state.strings.startAtLogin,
    type: 'checkbox',
    checked: state.startAtLogin.enabled,
    click: (item) => actions.setStartAtLogin(item.checked),
  }];
}

export function trayMenuTemplate(state: MenuState, actions: MenuActions): MenuItemConstructorOptions[] {
  return [
    { label: state.strings.open, click: () => actions.showWindow() },
    { type: 'separator' },
    ...startAtLoginItems(state, actions),
    { type: 'separator' },
    { label: state.strings.quit, click: () => actions.quit() },
  ];
}
