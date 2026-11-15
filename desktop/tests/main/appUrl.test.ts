import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEV_APP_URL, resolveAppUrl } from '../../src/main/appUrl.js';

const resolve = (argv: string[], env: Record<string, string | undefined>, isPackaged = true) =>
  resolveAppUrl({ argv, env, isPackaged });

describe('resolveAppUrl', () => {
  it('prefers --url over LINKORD_URL', () => {
    const result = resolve(['electron', '.', '--url=https://a.example'], { LINKORD_URL: 'https://b.example' });
    assert.equal(result.ok && result.url.origin, 'https://a.example');
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
