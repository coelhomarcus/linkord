import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checksAtStart, mainWindowMayShow, parseUpdateRepo, progressPercent, startWindowClose, updateMode } from '../../src/main/updates.js';

const repo = { owner: 'acme', repo: 'overcord' };

describe('parseUpdateRepo', () => {
  it('reads owner/repo', () => {
    assert.deepEqual(parseUpdateRepo(' acme/overcord '), repo);
    assert.deepEqual(parseUpdateRepo('a-b.c/d_e'), { owner: 'a-b.c', repo: 'd_e' });
  });

  it('refuses anything else', () => {
    for (const value of ['acme', 'acme/overcord/extra', 'https://github.com/acme/overcord', '../x/y', '', 42, null]) {
      assert.equal(parseUpdateRepo(value), null, String(value));
    }
  });
});

describe('updateMode', () => {
  const mode = (platform: NodeJS.Platform, extra: { isPackaged?: boolean; noRepo?: boolean } = {}) =>
    updateMode({ platform, isPackaged: extra.isPackaged ?? true, repo: extra.noRepo ? null : repo });

  it('installs on Windows', () => {
    assert.equal(mode('win32'), 'install');
  });

  it('is off anywhere else, in a development run or in a build without a repository', () => {
    assert.equal(mode('darwin'), 'off');
    assert.equal(mode('win32', { isPackaged: false }), 'off');
    assert.equal(mode('win32', { noRepo: true }), 'off');
  });
});

describe('progressPercent', () => {
  it('keeps whole percents between 0 and 100', () => {
    assert.equal(progressPercent(42.9), 42);
    assert.equal(progressPercent(-3), 0);
    assert.equal(progressPercent(100.4), 100);
  });

  it('reads anything else as 0', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, '50', undefined, null]) assert.equal(progressPercent(value), 0, String(value));
  });
});

describe('checksAtStart', () => {
  it('shows the check when the app opens a window and installs updates', () => {
    assert.equal(checksAtStart({ mode: 'install', startHidden: false }), true);
  });

  it('stays quiet for a start in the tray or a build that does not update', () => {
    assert.equal(checksAtStart({ mode: 'install', startHidden: true }), false);
    assert.equal(checksAtStart({ mode: 'off', startHidden: false }), false);
  });
});

describe('mainWindowMayShow', () => {
  it('keeps the app hidden for the whole start', () => {
    assert.equal(mainWindowMayShow('checking'), false);
    assert.equal(mainWindowMayShow('updating'), false);
    assert.equal(mainWindowMayShow('connecting'), false);
    assert.equal(mainWindowMayShow('open'), true);
  });
});

describe('startWindowClose', () => {
  it('quits when the start window is closed before the app opens', () => {
    assert.equal(startWindowClose({ phase: 'checking', quitting: false }), 'quit');
    assert.equal(startWindowClose({ phase: 'connecting', quitting: false }), 'quit');
  });

  it('cannot be closed once an update is on its way', () => {
    assert.equal(startWindowClose({ phase: 'updating', quitting: false }), 'refuse');
  });

  it('only closes after the start, and whenever the app quits', () => {
    assert.equal(startWindowClose({ phase: 'open', quitting: false }), 'close');
    assert.equal(startWindowClose({ phase: 'updating', quitting: true }), 'close');
    assert.equal(startWindowClose({ phase: 'connecting', quitting: true }), 'close');
  });
});
