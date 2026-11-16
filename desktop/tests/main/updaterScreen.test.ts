import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { STRINGS } from '../../src/main/strings.js';
import { updaterView } from '../../src/main/updaterScreen.js';

const strings = STRINGS['en-US'];

describe('updaterView', () => {
  it('shows a moving bar while it checks or installs', () => {
    assert.equal(updaterView({ kind: 'checking' }, strings).progress, null);
    assert.equal(updaterView({ kind: 'installing' }, strings).progress, null);
  });

  it('fills the bar with the download and names the version', () => {
    const view = updaterView({ kind: 'downloading', version: '1.4.0', percent: 37 }, strings);
    assert.equal(view.progress, 37);
    assert.equal(view.detail, 'Version 1.4.0 · 37%');
    assert.deepEqual(view.actions, []);
  });

  it('offers a restart, first, once a check from the tray has the update', () => {
    const view = updaterView({ kind: 'ready', version: '1.4.0' }, strings);
    assert.equal(view.progress, undefined);
    assert.deepEqual(view.actions.map((action) => [action.id, action.primary]), [['restart', true], ['later', false]]);
  });

  it('says what a check found with no bar', () => {
    const upToDate = updaterView({ kind: 'up-to-date', version: '1.3.0' }, strings);
    assert.equal(upToDate.tone, 'success');
    assert.equal(upToDate.progress, undefined);
    assert.match(upToDate.detail, /1\.3\.0/);
    const failed = updaterView({ kind: 'failed' }, strings);
    assert.equal(failed.tone, 'error');
    assert.deepEqual(failed.actions.map((action) => action.id), ['later']);
  });
});
