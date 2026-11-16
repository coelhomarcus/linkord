import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PREFERENCES, parsePreferenceChange, parsePreferences } from '../../src/main/preferences.js';

describe('parsePreferences', () => {
  it('keeps the app in the tray and starts it minimised unless told otherwise', () => {
    assert.deepEqual(parsePreferences(null), DEFAULT_PREFERENCES);
    assert.deepEqual(DEFAULT_PREFERENCES, { closeToTray: true, startMinimized: true });
  });

  it('reads saved choices and falls back for anything else', () => {
    assert.deepEqual(parsePreferences({ closeToTray: false, startMinimized: 'no', extra: 1 }), { closeToTray: false, startMinimized: true });
  });
});

describe('parsePreferenceChange', () => {
  it('takes only known keys set to true or false', () => {
    assert.deepEqual(parsePreferenceChange({ startMinimized: false, closeToTray: 1, path: '/etc' }), { startMinimized: false });
    assert.deepEqual(parsePreferenceChange('closeToTray'), {});
  });
});
