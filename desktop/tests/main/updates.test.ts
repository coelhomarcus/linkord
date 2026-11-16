import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseUpdateRepo, updateMode } from '../../src/main/updates.js';

const repo = { owner: 'acme', repo: 'linkord' };

describe('parseUpdateRepo', () => {
  it('reads owner/repo', () => {
    assert.deepEqual(parseUpdateRepo(' acme/linkord '), repo);
    assert.deepEqual(parseUpdateRepo('a-b.c/d_e'), { owner: 'a-b.c', repo: 'd_e' });
  });

  it('refuses anything else', () => {
    for (const value of ['acme', 'acme/linkord/extra', 'https://github.com/acme/linkord', '../x/y', '', 42, null]) {
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
    assert.equal(mode('linux'), 'off');
    assert.equal(mode('win32', { isPackaged: false }), 'off');
    assert.equal(mode('win32', { noRepo: true }), 'off');
  });
});
