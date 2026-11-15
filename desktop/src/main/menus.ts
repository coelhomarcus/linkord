import type { MenuItemConstructorOptions } from 'electron';
import { format, type Strings } from './strings.js';
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
  if (status.kind === 'available') return [{ label: format(s.downloadUpdate, { version: status.version }), click: () => actions.applyUpdate() }];
  if (mode === 'off') return [];
  return [{ label: s.checkForUpdates, click: () => actions.checkForUpdates() }];
}

export function trayMenuTemplate(state: MenuState, actions: MenuActions): MenuItemConstructorOptions[] {
  return [
    { label: state.strings.open, click: () => actions.showWindow() },
    separator,
    ...section(updateItems(state, actions)),
    ...section(startAtLoginItems(state, actions)),
    { label: state.strings.quit, click: () => actions.quit() },
  ];
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
