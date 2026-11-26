import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Fastify from 'fastify';
import { legacyAppRedirect, registerLegacyAppRedirect } from '../../src/http/legacyAppPaths.js';

describe('legacyAppRedirect', () => {
  it('moves an /app URL to the root, keeping its query', () => {
    assert.equal(legacyAppRedirect('/app'), '/');
    assert.equal(legacyAppRedirect('/app/'), '/');
    assert.equal(legacyAppRedirect('/app?x=1'), '/?x=1');
    assert.equal(legacyAppRedirect('/app/friends?tab=pending'), '/friends?tab=pending');
    assert.equal(legacyAppRedirect('/app/channels/@me/abc?message=12'), '/channels/@me/abc?message=12');
  });

  it('leaves other URLs alone', () => {
    assert.equal(legacyAppRedirect('/apple'), null);
    assert.equal(legacyAppRedirect('/friends'), null);
    assert.equal(legacyAppRedirect('/api/app'), null);
  });

  it('never points at another host', () => {
    assert.equal(legacyAppRedirect('//evil.test'), null);
    assert.equal(legacyAppRedirect('/app//evil.test/x'), '/evil.test/x');
    assert.equal(legacyAppRedirect('/app/\\evil.test'), '/evil.test');
    assert.equal(legacyAppRedirect('/app/%2F%2Fevil.test'), '/%2F%2Fevil.test');
  });
});

describe('GET /app/*', () => {
  async function inject(url: string, method: 'GET' | 'HEAD' | 'POST' = 'GET') {
    const app = Fastify();
    registerLegacyAppRedirect(app);
    const response = await app.inject({ method, url });
    await app.close();
    return response;
  }

  it('redirects permanently to the same page at the root', async () => {
    const response = await inject('/app/settings/privacy?from=email');
    assert.equal(response.statusCode, 301);
    assert.equal(response.headers.location, '/settings/privacy?from=email');
    assert.equal((await inject('/app')).headers.location, '/');
    assert.equal((await inject('/app/friends', 'HEAD')).headers.location, '/friends');
  });

  it('answers nothing but reads', async () => {
    assert.equal((await inject('/app/friends', 'POST')).statusCode, 404);
  });
});
