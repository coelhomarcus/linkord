import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEV_APP_URL, parseAppConfig, resolveAppUrl } from '../../src/main/appUrl.js';

const resolve = (argv: string[], env: Record<string, string | undefined>, isPackaged = true) =>
  resolveAppUrl({ argv, env, isPackaged });

describe('resolveAppUrl', () => {
  it('prefers --url over LINKORD_URL', () => {
    const result = resolve(['electron', '.', '--url=https://a.example'], { LINKORD_URL: 'https://b.example' });
    assert.equal(result.ok && result.url.origin, 'https://a.example');
  });

  it('ignores --url on a start from a linkord:// link', () => {
    const result = resolveAppUrl({
      argv: ['Linkord.exe', '--url=https://evil.example', 'linkord://invite/abcd2345'],
      env: {},
      isPackaged: true,
      bundledUrl: 'https://baked.example',
    });
    assert.equal(result.ok && result.url.origin, 'https://baked.example');
  });

  it('reads LINKORD_URL', () => {
    const result = resolve([], { LINKORD_URL: ' https://chat.example/ ' });
    assert.equal(result.ok && result.url.origin, 'https://chat.example');
  });

  it('falls back to the Vite dev server only when not packaged', () => {
    const dev = resolve([], {}, false);
    assert.equal(dev.ok && dev.url.href, `${DEV_APP_URL}/`);
    assert.deepEqual(resolve([], {}, true), { ok: false, reason: 'missing' });
  });

  it('uses the address baked into an installer, unless --url or LINKORD_URL overrides it', () => {
    const baked = (argv: string[], env: Record<string, string>) =>
      resolveAppUrl({ argv, env, isPackaged: true, bundledUrl: 'https://baked.example' });
    const fromInstaller = baked([], {});
    assert.equal(fromInstaller.ok && fromInstaller.url.origin, 'https://baked.example');
    const overridden = baked([], { LINKORD_URL: 'https://other.example' });
    assert.equal(overridden.ok && overridden.url.origin, 'https://other.example');
  });

  it('refuses plain http outside this machine', () => {
    assert.equal(resolve([], { LINKORD_URL: 'http://chat.example' }).ok, false);
    assert.equal(resolve([], { LINKORD_URL: 'http://127.0.0.1:3000' }).ok, true);
    assert.equal(resolve([], { LINKORD_URL: 'http://[::1]:3000' }).ok, true);
  });

  it('refuses addresses that are not http(s)', () => {
    assert.deepEqual(resolve([], { LINKORD_URL: 'file:///etc/passwd' }), { ok: false, reason: 'invalid', value: 'file:///etc/passwd' });
    assert.deepEqual(resolve([], { LINKORD_URL: 'not a url' }), { ok: false, reason: 'invalid', value: 'not a url' });
  });
});

describe('parseAppConfig', () => {
  it('reads the url and ignores anything else', () => {
    assert.deepEqual(parseAppConfig({ url: 'https://chat.example' }), { url: 'https://chat.example' });
    assert.deepEqual(parseAppConfig({ url: 3 }), {});
    assert.deepEqual(parseAppConfig(null), {});
  });

  it('reads the update repository only when it is owner/repo', () => {
    assert.deepEqual(parseAppConfig({ url: 'https://chat.example', updateRepo: 'acme/linkord' }), {
      url: 'https://chat.example',
      updateRepo: { owner: 'acme', repo: 'linkord' },
    });
    assert.deepEqual(parseAppConfig({ url: 'https://chat.example', updateRepo: 'https://github.com/acme/linkord' }), { url: 'https://chat.example' });
  });
});
