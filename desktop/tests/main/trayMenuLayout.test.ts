import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TRAY_CLICK_ECHO_MS, TRAY_MENU, drawsTrayMenu, echoesTrayClick, trayMenuPosition, trayMenuSize } from '../../src/main/trayMenuLayout.js';

const display = { x: 0, y: 0, width: 1920, height: 1080 };
const size = { width: 296, height: 220 };
const shadow = TRAY_MENU.shadow;
const menuOf = (window: { x: number; y: number }) => ({
  left: window.x + shadow, top: window.y + shadow,
  right: window.x + size.width - shadow, bottom: window.y + size.height - shadow,
});

describe('trayMenuPosition', () => {
  it('puts the menu\'s bottom-right corner at the pointer on a bottom taskbar, over the taskbar as Windows does', () => {
    const menu = menuOf(trayMenuPosition({ x: 1800, y: 1060 }, size, display));
    assert.equal(menu.right, 1800);
    assert.equal(menu.bottom, 1060);
  });

  it('puts the top-left corner at the pointer on a top-left tray', () => {
    const menu = menuOf(trayMenuPosition({ x: 40, y: 10 }, size, display));
    assert.equal(menu.left, 40);
    assert.equal(menu.top, 10);
  });

  it('keeps the menu, not its shadow, inside a second screen', () => {
    const second = { x: 1920, y: 0, width: 1280, height: 1000 };
    const menu = menuOf(trayMenuPosition({ x: 3195, y: 40 }, size, second));
    assert.ok(menu.left >= second.x && menu.right <= second.x + second.width);
    assert.ok(menu.top >= second.y && menu.bottom <= second.y + second.height);
  });
});

describe('trayMenuSize', () => {
  it('fits the header, each item and separator, and the shadow margin', () => {
    const items = [{ kind: 'action' }, { kind: 'separator' }, { kind: 'toggle' }, { kind: 'action' }];
    const { width, height } = trayMenuSize(items);
    assert.equal(width, TRAY_MENU.width + TRAY_MENU.shadow * 2);
    assert.equal(height, TRAY_MENU.header + TRAY_MENU.item * 3 + TRAY_MENU.separator + TRAY_MENU.padding * 2 + TRAY_MENU.shadow * 2);
  });
});

describe('drawsTrayMenu', () => {
  it('draws it on Windows, and elsewhere only when asked in a development run', () => {
    assert.equal(drawsTrayMenu({ platform: 'win32', env: {}, isPackaged: true }), true);
    assert.equal(drawsTrayMenu({ platform: 'darwin', env: {}, isPackaged: true }), false);
    assert.equal(drawsTrayMenu({ platform: 'linux', env: { LINKORD_TRAY_MENU: 'drawn' }, isPackaged: false }), true);
    assert.equal(drawsTrayMenu({ platform: 'linux', env: { LINKORD_TRAY_MENU: 'drawn' }, isPackaged: true }), false);
  });
});

describe('echoesTrayClick', () => {
  it('takes the second report of the same right click for an echo', () => {
    assert.equal(echoesTrayClick(1000, 1120), true);
  });

  it('opens again for a right click after the echo window', () => {
    assert.equal(echoesTrayClick(1000, 1000 + TRAY_CLICK_ECHO_MS), false);
  });

  it('opens when the menu was never shown or the clock went back', () => {
    assert.equal(echoesTrayClick(null, 1000), false);
    assert.equal(echoesTrayClick(2000, 1000), false);
  });
});
