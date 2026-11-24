import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseFullScreenRequest, TITLE_BAR_HEIGHT, titleBarOptions, titleBarStyle, windowState } from '../../src/main/titleBar.js';

describe('titleBarOptions', () => {
  it('hides the system title bar everywhere', () => {
    for (const platform of ['darwin', 'win32'] as const) assert.equal(titleBarOptions(platform).titleBarStyle, 'hidden');
  });

  it('centres the macOS traffic lights in the page bar', () => {
    const { trafficLightPosition } = titleBarOptions('darwin');
    assert.ok(trafficLightPosition);
    assert.equal(trafficLightPosition.y * 2 + 14, TITLE_BAR_HEIGHT);
    assert.equal(titleBarOptions('win32').trafficLightPosition, undefined);
  });
});

describe('windowState', () => {
  it('reads what the page bar shows', () => {
    const window = { isMaximized: () => true, isFullScreen: () => false, isFocused: () => true };
    assert.deepEqual(windowState(window), { maximized: true, fullScreen: false, focused: true });
  });
});

describe('parseFullScreenRequest', () => {
  it('takes only a yes or a no', () => {
    assert.equal(parseFullScreenRequest(true), true);
    assert.equal(parseFullScreenRequest(false), false);
    for (const value of [undefined, null, 1, 'true', {}]) assert.equal(parseFullScreenRequest(value), null);
  });
});

describe('titleBarStyle', () => {
  const style = (platform: NodeJS.Platform, env: Record<string, string> = {}, isPackaged = true) => titleBarStyle({ platform, env, isPackaged });

  it('follows the system', () => {
    assert.equal(style('darwin'), 'mac');
    assert.equal(style('win32'), 'windows');
    assert.equal(style('linux'), 'windows');
  });

  it('takes LINKORD_TITLE_BAR only in a development run', () => {
    assert.equal(style('darwin', { LINKORD_TITLE_BAR: 'windows' }, false), 'windows');
    assert.equal(style('darwin', { LINKORD_TITLE_BAR: 'windows' }, true), 'mac');
    assert.equal(style('darwin', { LINKORD_TITLE_BAR: 'beos' }, false), 'mac');
  });
});
