import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { MenuItemConstructorOptions } from 'electron';
import { trayMenuTemplate, type MenuActions, type MenuState } from '../../src/main/menus.js';
import { STRINGS } from '../../src/main/strings.js';

const strings = STRINGS['en-US'];

function recorder() {
  const calls: string[] = [];
  const actions: MenuActions = {
    showWindow: () => calls.push('show'),
    setStartAtLogin: (enabled) => calls.push(`login:${enabled}`),
    quit: () => calls.push('quit'),
  };
  return { calls, actions };
}

const state = (overrides: Partial<MenuState> = {}): MenuState => ({
  strings,
  startAtLogin: { available: true, enabled: false },
  ...overrides,
});

const find = (items: MenuItemConstructorOptions[], label: string) => items.find((item) => item.label === label);
const click = (item: MenuItemConstructorOptions | undefined, checked?: boolean) =>
  (item?.click as unknown as (menuItem: { checked?: boolean }) => void)({ checked });

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
  });
});
