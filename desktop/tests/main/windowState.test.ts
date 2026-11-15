import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SIZE, MIN_SIZE, parseWindowState, placeWindow } from '../../src/main/windowState.js';

const SCREEN = { x: 0, y: 0, width: 1920, height: 1080 };
const SECOND_SCREEN = { x: 1920, y: 0, width: 1280, height: 1024 };

describe('parseWindowState', () => {
  it('reads a saved state', () => {
    assert.deepEqual(
      parseWindowState({ bounds: { x: 10, y: 20, width: 800, height: 600 }, maximized: true }),
      { bounds: { x: 10, y: 20, width: 800, height: 600 }, maximized: true },
    );
  });

  it('rejects anything malformed', () => {
    assert.equal(parseWindowState(null), null);
    assert.equal(parseWindowState('x'), null);
    assert.equal(parseWindowState({ bounds: { x: 1, y: 2, width: 3 } }), null);
    assert.equal(parseWindowState({ bounds: { x: 1, y: 2, width: 3, height: Number.NaN } }), null);
  });
});

describe('placeWindow', () => {
  it('opens at the default size the first time', () => {
    assert.deepEqual(placeWindow(null, [SCREEN]), { bounds: DEFAULT_SIZE, maximized: false });
  });

  it('restores a place that is still on a screen', () => {
    const saved = { bounds: { x: 2000, y: 100, width: 900, height: 700 }, maximized: false };
    assert.deepEqual(placeWindow(saved, [SCREEN, SECOND_SCREEN]), saved);
  });

  it('drops the position when that screen is gone, keeping the size', () => {
    const saved = { bounds: { x: 2000, y: 100, width: 900, height: 700 }, maximized: true };
    assert.deepEqual(placeWindow(saved, [SCREEN]), { bounds: { width: 900, height: 700 }, maximized: true });
  });

  it('drops a position whose title bar is off screen', () => {
    const saved = { bounds: { x: 100, y: -500, width: 900, height: 700 }, maximized: false };
    assert.equal(placeWindow(saved, [SCREEN]).bounds.x, undefined);
  });

  it('never restores below the minimum size', () => {
    const saved = { bounds: { x: 0, y: 0, width: 10, height: 10 }, maximized: false };
    const { bounds } = placeWindow(saved, [SCREEN]);
    assert.equal(bounds.width, MIN_SIZE.width);
    assert.equal(bounds.height, MIN_SIZE.height);
  });
});
