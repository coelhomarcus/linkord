import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { MenuItemConstructorOptions } from 'electron';
import { appMenuTemplate, trayMenuTemplate, type MenuActions, type MenuState } from '../../src/main/menus.js';
import { STRINGS } from '../../src/main/strings.js';

const strings = STRINGS['en-US'];

function recorder() {
  const calls: string[] = [];
  const actions: MenuActions = {
    showWindow: () => calls.push('show'),
    setStartAtLogin: (enabled) => calls.push(`login:${enabled}`),
    checkForUpdates: () => calls.push('check'),
    applyUpdate: () => calls.push('apply'),
    openInBrowser: () => calls.push('browser'),
    quit: () => calls.push('quit'),
  };
  return { calls, actions };
}

const state = (overrides: Partial<MenuState> = {}): MenuState => ({
  platform: 'darwin',
  strings,
  startAtLogin: { available: true, enabled: false },
  update: { mode: 'install', status: { kind: 'idle' } },
  devTools: false,
  ...overrides,
});

type Item = MenuItemConstructorOptions;
const children = (item: Item | undefined) => (item?.submenu ?? []) as Item[];
const flatten = (items: Item[]): Item[] => items.flatMap((item) => [item, ...flatten(children(item))]);
const find = (items: Item[], label: string) => flatten(items).find((item) => item.label === label);
const click = (item: Item | undefined, checked?: boolean) =>
  (item?.click as unknown as (menuItem: { checked?: boolean }) => void)({ checked });

function assertNoAdjacentSeparators(items: Item[]): void {
  for (const list of [items, ...flatten(items).map(children)]) {
    list.forEach((item, index) => {
      assert.ok(!(item.type === 'separator' && (index === 0 || index === list.length - 1 || list[index + 1]?.type === 'separator')),
        'a separator at an edge or next to another');
    });
  }
}

describe('trayMenuTemplate', () => {
  it('opens the window and quits', () => {
    const { calls, actions } = recorder();
    const items = trayMenuTemplate(state(), actions);
    click(find(items, strings.open));
    click(find(items, strings.quit));
    assert.deepEqual(calls, ['show', 'quit']);
  });

  it('toggles start at login with the checkbox state', () => {
    const { calls, actions } = recorder();
    const item = find(trayMenuTemplate(state({ startAtLogin: { available: true, enabled: true } }), actions), strings.startAtLogin);
    assert.equal(item?.checked, true);
    click(item, false);
    assert.deepEqual(calls, ['login:false']);
  });

  it('leaves start at login out where it is not available', () => {
    const { actions } = recorder();
    const items = trayMenuTemplate(state({ startAtLogin: { available: false, enabled: false } }), actions);
    assert.equal(find(items, strings.startAtLogin), undefined);
    assertNoAdjacentSeparators(items);
  });
});

describe('appMenuTemplate', () => {
  it('starts with the app menu on macOS and a File menu elsewhere', () => {
    const { actions } = recorder();
    assert.equal(appMenuTemplate(state(), actions)[0]?.label, 'Linkord');
    assert.equal(appMenuTemplate(state({ platform: 'win32' }), actions)[0]?.label, strings.file);
    assert.equal(appMenuTemplate(state({ platform: 'linux' }), actions)[0]?.label, strings.file);
  });

  it('keeps the edit roles, which the copy and paste shortcuts need on macOS', () => {
    const { actions } = recorder();
    const roles = flatten(appMenuTemplate(state(), actions)).map((item) => item.role);
    for (const role of ['copy', 'paste', 'cut', 'selectAll', 'undo', 'quit'] as const) assert.ok(roles.includes(role), role);
  });

  it('offers start at login and opening the server in the browser', () => {
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      const { calls, actions } = recorder();
      const items = appMenuTemplate(state({ platform }), actions);
      click(find(items, strings.startAtLogin), true);
      click(find(items, strings.openInBrowser));
      assert.deepEqual(calls, ['login:true', 'browser'], platform);
    }
  });

  it('shows the developer tools only in a development run', () => {
    const { actions } = recorder();
    const roles = (devTools: boolean) => flatten(appMenuTemplate(state({ devTools }), actions)).map((item) => item.role);
    assert.ok(!roles(false).includes('toggleDevTools'));
    assert.ok(roles(true).includes('toggleDevTools'));
  });

  it('never puts two separators together', () => {
    const { actions } = recorder();
    for (const platform of ['darwin', 'win32'] as const) {
      for (const available of [true, false]) {
        for (const mode of ['install', 'off'] as const) {
          const menuState = state({ platform, startAtLogin: { available, enabled: false }, update: { mode, status: { kind: 'idle' } } });
          assertNoAdjacentSeparators(appMenuTemplate(menuState, actions));
          assertNoAdjacentSeparators(trayMenuTemplate(menuState, actions));
        }
      }
    }
  });
});

describe('update items', () => {
  const labels = (update: MenuState['update']) => {
    const { actions } = recorder();
    return {
      tray: flatten(trayMenuTemplate(state({ update }), actions)).map((item) => item.label),
      app: flatten(appMenuTemplate(state({ update, platform: 'win32' }), actions)).map((item) => item.label),
    };
  };

  it('offers a check when updates are on, and nothing when off', () => {
    assert.ok(labels({ mode: 'notify', status: { kind: 'idle' } }).tray.includes(strings.checkForUpdates));
    assert.ok(labels({ mode: 'install', status: { kind: 'idle' } }).app.includes(strings.checkForUpdates));
    const off = labels({ mode: 'off', status: { kind: 'idle' } });
    assert.ok(!off.tray.includes(strings.checkForUpdates) && !off.app.includes(strings.checkForUpdates));
  });

  it('turns the check into the next step once there is an update', () => {
    const ready = labels({ mode: 'install', status: { kind: 'downloaded', version: '1.2.0' } });
    assert.ok(ready.tray.includes(strings.restartToUpdate) && !ready.tray.includes(strings.checkForUpdates));
    const available = labels({ mode: 'notify', status: { kind: 'available', version: '1.2.0', url: 'https://github.com/o/r/releases/tag/v1.2.0' } });
    assert.ok(available.app.includes('Download version 1.2.0'));
  });

  it('calls check and apply', () => {
    const { calls, actions } = recorder();
    click(find(trayMenuTemplate(state(), actions), strings.checkForUpdates));
    click(find(trayMenuTemplate(state({ update: { mode: 'install', status: { kind: 'downloaded', version: '1.2.0' } } }), actions), strings.restartToUpdate));
    assert.deepEqual(calls, ['check', 'apply']);
  });
});
