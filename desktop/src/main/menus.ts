import type { MenuItemConstructorOptions } from 'electron';
import type { Strings } from './strings.js';
import type { UpdateMode, UpdateStatus } from './updates.js';

// Menu templates as plain data, so what each menu offers is tested without
// Electron; index.ts builds them again whenever the state changes.

export interface MenuState {
  platform: NodeJS.Platform;
  strings: Strings;
  startAtLogin: { available: boolean; enabled: boolean };
  update: { mode: UpdateMode; status: UpdateStatus };
  /** a development run; installers leave the developer tools out of the menu */
  devTools: boolean;
}

export interface MenuActions {
  showWindow(): void;
  setStartAtLogin(enabled: boolean): void;
  checkForUpdates(): void;
  applyUpdate(): void;
  openInBrowser(): void;
  quit(): void;
}

const separator: MenuItemConstructorOptions = { type: 'separator' };

/** A group of items followed by a separator, or nothing, so no two separators meet. */
const section = (items: MenuItemConstructorOptions[]) => (items.length ? [...items, separator] : []);

function startAtLoginItems(state: MenuState, actions: MenuActions): MenuItemConstructorOptions[] {
  if (!state.startAtLogin.available) return [];
  return [{
    label: state.strings.startAtLogin,
    type: 'checkbox',
    checked: state.startAtLogin.enabled,
    click: (item) => actions.setStartAtLogin(item.checked),
  }];
}

function updateItems(state: MenuState, actions: MenuActions): MenuItemConstructorOptions[] {
  const { mode, status } = state.update;
  const s = state.strings;
  if (status.kind === 'downloaded') return [{ label: s.restartToUpdate, click: () => actions.applyUpdate() }];
  if (mode === 'off') return [];
  return [{ label: s.checkForUpdates, click: () => actions.checkForUpdates() }];
}

/** The tray menu as data: the native menu (macOS, Linux) and the drawn one (Windows, trayMenuWindow.ts) both come from it. */
export type TrayMenuItem =
  | { kind: 'action'; id: 'open' | 'update' | 'quit'; label: string }
  | { kind: 'toggle'; id: 'startAtLogin'; label: string; checked: boolean }
  | { kind: 'separator' };

export function trayMenuItems(state: MenuState): TrayMenuItem[] {
  const s = state.strings;
  const { mode, status } = state.update;
  const update = status.kind === 'downloaded' ? s.restartToUpdate
    : mode === 'off' ? null
      : s.checkForUpdates;
  const items: TrayMenuItem[] = [{ kind: 'action', id: 'open', label: s.open }, { kind: 'separator' }];
  if (state.startAtLogin.available) items.push({ kind: 'toggle', id: 'startAtLogin', label: s.startAtLogin, checked: state.startAtLogin.enabled });
  if (update) items.push({ kind: 'action', id: 'update', label: update });
  if (items.at(-1)?.kind !== 'separator') items.push({ kind: 'separator' });
  items.push({ kind: 'action', id: 'quit', label: s.quit });
  return items;
}

/** What choosing an item does. Toggles carry the new state. */
export function runTrayItem(state: MenuState, actions: MenuActions, id: string, checked?: boolean): void {
  if (id === 'open') actions.showWindow();
  else if (id === 'quit') actions.quit();
  else if (id === 'startAtLogin') actions.setStartAtLogin(checked ?? !state.startAtLogin.enabled);
  else if (id === 'update') {
    if (state.update.status.kind === 'idle') actions.checkForUpdates();
    else actions.applyUpdate();
  }
}

export function trayMenuTemplate(state: MenuState, actions: MenuActions): MenuItemConstructorOptions[] {
  return trayMenuItems(state).map((item): MenuItemConstructorOptions => {
    if (item.kind === 'separator') return separator;
    if (item.kind === 'toggle') return { label: item.label, type: 'checkbox', checked: item.checked, click: (menuItem) => runTrayItem(state, actions, item.id, menuItem.checked) };
    return { label: item.label, click: () => runTrayItem(state, actions, item.id) };
  });
}

function editMenu(s: Strings): MenuItemConstructorOptions {
  return {
    label: s.edit,
    submenu: [
      { role: 'undo', label: s.undo },
      { role: 'redo', label: s.redo },
      separator,
      { role: 'cut', label: s.cut },
      { role: 'copy', label: s.copy },
      { role: 'paste', label: s.paste },
      { role: 'pasteAndMatchStyle', label: s.pasteAndMatchStyle },
      { role: 'selectAll', label: s.selectAll },
    ],
  };
}

function viewMenu(state: MenuState): MenuItemConstructorOptions {
  const s = state.strings;
  return {
    label: s.view,
    submenu: [
      { role: 'reload', label: s.reload },
      separator,
      { role: 'resetZoom', label: s.actualSize },
      { role: 'zoomIn', label: s.zoomIn },
      { role: 'zoomOut', label: s.zoomOut },
      separator,
      { role: 'togglefullscreen', label: s.toggleFullScreen },
      ...(state.devTools ? [separator, { role: 'toggleDevTools', label: s.developerTools } as const] : []),
    ],
  };
}

/**
 * The application menu. macOS shows it in the menu bar, with the app menu
 * first; Windows and Linux keep it hidden in the window until Alt is pressed.
 */
export function appMenuTemplate(state: MenuState, actions: MenuActions): MenuItemConstructorOptions[] {
  const s = state.strings;
  const help: MenuItemConstructorOptions = {
    role: 'help',
    label: s.help,
    submenu: [
      { label: s.openInBrowser, click: () => actions.openInBrowser() },
      ...(state.platform === 'darwin' ? [] : [separator, ...section(updateItems(state, actions)), { role: 'about', label: s.about } as const]),
    ],
  };

  if (state.platform !== 'darwin') {
    return [
      { label: s.file, submenu: [...section(startAtLoginItems(state, actions)), { role: 'quit', label: s.quit }] },
      editMenu(s),
      viewMenu(state),
      help,
    ];
  }

  return [
    {
      label: 'Linkord',
      submenu: [
        { role: 'about', label: s.about },
        separator,
        ...section(updateItems(state, actions)),
        ...section(startAtLoginItems(state, actions)),
        { role: 'services', label: s.services },
        separator,
        { role: 'hide', label: s.hide },
        { role: 'hideOthers', label: s.hideOthers },
        { role: 'unhide', label: s.showAll },
        separator,
        { role: 'quit', label: s.quit },
      ],
    },
    editMenu(s),
    viewMenu(state),
    {
      role: 'window',
      label: s.window,
      submenu: [
        { role: 'minimize', label: s.minimize },
        { role: 'zoom', label: s.zoom },
        separator,
        { role: 'front', label: s.front },
      ],
    },
    help,
  ];
}
