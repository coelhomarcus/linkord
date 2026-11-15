import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isNewerVersion, latestReleaseApiUrl, newerRelease, parseUpdateRepo, updateMode } from '../../src/main/updates.js';

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
  const mode = (platform: NodeJS.Platform, extra: { isPackaged?: boolean; appImage?: string; noRepo?: boolean } = {}) =>
    updateMode({ platform, isPackaged: extra.isPackaged ?? true, repo: extra.noRepo ? null : repo, appImage: extra.appImage });

  it('installs on Windows and from an AppImage', () => {
    assert.equal(mode('win32'), 'install');
    assert.equal(mode('linux', { appImage: '/home/a/Linkord.AppImage' }), 'install');
  });

  it('only tells about it on macOS and from a .deb', () => {
    assert.equal(mode('darwin'), 'notify');
    assert.equal(mode('linux'), 'notify');
  });

  it('is off in a development run or a build without a repository', () => {
    assert.equal(mode('win32', { isPackaged: false }), 'off');
    assert.equal(mode('darwin', { noRepo: true }), 'off');
  });
});

describe('isNewerVersion', () => {
  it('compares major, minor and patch as numbers', () => {
    assert.equal(isNewerVersion('v0.10.0', '0.9.9'), true);
    assert.equal(isNewerVersion('1.0.0', '0.99.0'), true);
    assert.equal(isNewerVersion('0.2.1', '0.2.1'), false);
    assert.equal(isNewerVersion('0.2.0', '0.2.1'), false);
  });

  it('ignores versions it cannot read', () => {
    assert.equal(isNewerVersion('v2.0.0-beta.1', '1.0.0'), false);
    assert.equal(isNewerVersion('desktop-2', '1.0.0'), false);
  });
});

describe('newerRelease', () => {
  const release = (overrides: Record<string, unknown> = {}) => ({
    tag_name: 'v0.3.0',
    html_url: 'https://github.com/acme/linkord/releases/tag/v0.3.0',
    draft: false,
    prerelease: false,
    ...overrides,
  });

  it('returns a newer release of the same repository', () => {
    assert.deepEqual(newerRelease(release(), '0.2.0', repo), { version: '0.3.0', url: 'https://github.com/acme/linkord/releases/tag/v0.3.0' });
  });

  it('skips the current version, drafts and prereleases', () => {
    assert.equal(newerRelease(release(), '0.3.0', repo), null);
    assert.equal(newerRelease(release({ draft: true }), '0.2.0', repo), null);
    assert.equal(newerRelease(release({ prerelease: true }), '0.2.0', repo), null);
  });

  it('never opens a page outside the repository releases', () => {
    assert.equal(newerRelease(release({ html_url: 'https://evil.example/releases/tag/v0.3.0' }), '0.2.0', repo), null);
    assert.equal(newerRelease(release({ html_url: 'https://github.com/other/linkord/releases/tag/v0.3.0' }), '0.2.0', repo), null);
  });

  it('builds the API address', () => {
    assert.equal(latestReleaseApiUrl(repo), 'https://api.github.com/repos/acme/linkord/releases/latest');
  });
});
