import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';
import { isCorsEligible, isTrustedCrossOrigin } from '../../src/http/cors.js';
import { config } from '../../src/config/env.js';
import { createApp } from '../../src/http/app.js';
import type { FastifyInstance } from 'fastify';

describe('isCorsEligible', () => {
  // The actual regression this guards: /uploads/* (avatars, attachments)
  // was left out of the CORS hook, so a native build's own-token fetch for
  // an avatar was blocked by the browser before the response ever reached
  // app code — a 401 would at least have been visible; this failed silently.
  it('/api/* and /uploads/* are eligible', () => {
    assert.equal(isCorsEligible('/api/auth/me'), true);
    assert.equal(isCorsEligible('/uploads/abc123'), true);
  });

  it('static assets and the SPA fallback are not — a native build ships its own', () => {
    assert.equal(isCorsEligible('/'), false);
    assert.equal(isCorsEligible('/assets/index-abc.js'), false);
    assert.equal(isCorsEligible('/healthz'), false);
  });
});

describe('isTrustedCrossOrigin', () => {
  it('no Origin header is not cross-origin', () => {
    assert.equal(isTrustedCrossOrigin(undefined, 'app.example.com'), false);
  });

  it('an Origin matching the request host is same-origin, not cross', () => {
    assert.equal(isTrustedCrossOrigin('https://app.example.com', 'app.example.com'), false);
  });
});

describe('corsHeaders (integration)', () => {
  let app: FastifyInstance;
  const previousAllowed = config.ALLOWED_ORIGINS;

  before(async () => {
    config.ALLOWED_ORIGINS = ['tauri://localhost'];
    app = createApp();
    await app.ready();
  });

  after(async () => {
    config.ALLOWED_ORIGINS = previousAllowed;
    await app.close();
  });

  it('tags a GET to /uploads/* from a trusted native origin with CORS headers', async () => {
    const res = await app.inject({ method: 'GET', url: '/uploads/nonexistent', headers: { origin: 'tauri://localhost' } });
    assert.equal(res.headers['access-control-allow-origin'], 'tauri://localhost');
    assert.equal(res.headers['access-control-allow-credentials'], 'true');
  });

  it('the preflight allows the Authorization header the native shells send their token with', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/api/auth/me',
      headers: { origin: 'tauri://localhost', 'access-control-request-method': 'GET' },
    });
    assert.equal(res.statusCode, 204);
    assert.match(res.headers['access-control-allow-headers'] as string, /Authorization/);
  });

  it('an untrusted origin gets no CORS headers on /uploads/*', async () => {
    const res = await app.inject({ method: 'GET', url: '/uploads/nonexistent', headers: { origin: 'https://evil.example.net' } });
    assert.equal(res.headers['access-control-allow-origin'], undefined);
  });

  it('a same-origin request (no cross-site Origin) is untouched', async () => {
    const res = await app.inject({ method: 'GET', url: '/uploads/nonexistent' });
    assert.equal(res.headers['access-control-allow-origin'], undefined);
  });
});
