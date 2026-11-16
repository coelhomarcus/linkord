import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TRAY_CLICK_ECHO_MS, TRAY_MENU, drawsTrayMenu, echoesTrayClick, trayMenuPosition, trayMenuSize } from '../../src/main/trayMenuLayout.js';

const workArea = { x: 0, y: 0, width: 1920, height: 1040 };
const size = { width: 296, height: 220 };

describe('trayMenuPosition', () => {
  it('opens upwards from a bottom taskbar, leftwards near the right edge', () => {
    assert.deepEqual(trayMenuPosition({ x: 1800, y: 1060 }, size, workArea), { x: 1504, y: 820 });
  });

  it('opens downwards and rightwards from a top-left tray', () => {
    assert.deepEqual(trayMenuPosition({ x: 40, y: 10 }, size, workArea), { x: 40, y: 10 });
  });

  it('stays inside the work area of a second screen', () => {
    const second = { x: 1920, y: 0, width: 1280, height: 1000 };
    const { x, y } = trayMenuPosition({ x: 3190, y: 1030 }, size, second);
    assert.ok(x >= second.x && x + size.width <= second.x + second.width);
    assert.ok(y >= second.y && y + size.height <= second.y + second.height);
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
