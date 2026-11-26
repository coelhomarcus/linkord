import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createDesktopDownloads, parseLatestRelease } from '../../../src/modules/desktop/desktopDownloads.js';

const REPO = 'acme/overcord';
const asset = (name: string, repo = REPO) => ({ name, browser_download_url: `https://github.com/${repo}/releases/download/v0.3.0/${name}` });
const release = (overrides: Record<string, unknown> = {}) => ({
  tag_name: 'v0.3.0',
  html_url: `https://github.com/${REPO}/releases/tag/v0.3.0`,
  draft: false,
  prerelease: false,
  assets: [
    asset('Overcord-0.3.0-win-x64.exe'), asset('Overcord-0.3.0-mac-arm64.dmg'), asset('Overcord-0.3.0-mac-x64.dmg'),
    asset('Overcord-0.3.0-linux-x86_64.AppImage'), asset('Overcord-0.3.0-linux-amd64.deb'), asset('overcord.yml'),
  ],
  ...overrides,
});

describe('parseLatestRelease', () => {
  test('picks the Windows installer and the release page, leaving older systems\' files out', () => {
    const downloads = parseLatestRelease(release(), REPO);
    assert.deepEqual(downloads, {
      version: '0.3.0',
      page: `https://github.com/${REPO}/releases/tag/v0.3.0`,
      files: { windows: `https://github.com/${REPO}/releases/download/v0.3.0/Overcord-0.3.0-win-x64.exe` },
    });
  });

  test('takes no link outside the repository\'s releases', () => {
    const downloads = parseLatestRelease(release({ assets: [asset('Overcord-0.3.0-win-x64.exe', 'evil/overcord')] }), REPO);
    assert.equal(downloads, null);
    assert.equal(parseLatestRelease(release({ html_url: 'https://evil.example/x' }), REPO), null);
  });

  test('ignores drafts, prereleases and releases without an Overcord Windows installer', () => {
    assert.equal(parseLatestRelease(release({ draft: true }), REPO), null);
    assert.equal(parseLatestRelease(release({ prerelease: true }), REPO), null);
    assert.equal(parseLatestRelease(release({ assets: [asset('notes.txt')] }), REPO), null);
    assert.equal(parseLatestRelease(release({ assets: [asset('Overcord-0.3.0-mac-arm64.dmg')] }), REPO), null);
    assert.equal(parseLatestRelease(release({ assets: [asset('Linkord-0.3.0-win-x64.exe')] }), REPO), null);
  });
});

describe('createDesktopDownloads', () => {
  test('asks GitHub once while the answer is fresh', async () => {
    let calls = 0;
    let time = 0;
    const latest = createDesktopDownloads({ repo: REPO, now: () => time, request: async () => { calls++; return release(); } });
    assert.equal((await latest())?.version, '0.3.0');
    await latest();
    assert.equal(calls, 1);
    time += 16 * 60 * 1000;
    await latest();
    assert.equal(calls, 2);
  });

  test('keeps the last good answer when GitHub fails', async () => {
    let fail = false;
    let time = 0;
    const latest = createDesktopDownloads({ repo: REPO, now: () => time, request: async () => { if (fail) throw new Error('down'); return release(); } });
    await latest();
    fail = true;
    time += 16 * 60 * 1000;
    assert.equal((await latest())?.version, '0.3.0');
  });

  test('says nothing without a repository', async () => {
    let calls = 0;
    const latest = createDesktopDownloads({ repo: '', request: async () => { calls++; return release(); } });
    assert.equal(await latest(), null);
    assert.equal(calls, 0);
  });
});
