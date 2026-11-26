import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { config } from '../../src/config/env.js';
import { adminSite } from '../../src/http/adminSite.js';
import { isSocketOriginAllowed, originGuard } from '../../src/http/originGuard.js';
import { securityHeaders } from '../../src/http/securityHeaders.js';

const APP_HOST = 'chat.example.com';
const ADMIN = { url: 'https://admin.example.com', host: 'admin.example.com', secure: true };

function write(dir: string, file: string, text: string) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
}

/** The same hooks and fallbacks as createApp, around stand-in routes. */
async function buildApp(webDir: string, adminDir: string): Promise<FastifyInstance> {
  const admin = config.ADMIN_ORIGIN && { dir: adminDir, url: config.ADMIN_ORIGIN.url, host: config.ADMIN_ORIGIN.host };
  const app = Fastify();
  app.addHook('onRequest', securityHeaders(webDir, admin));
  app.addHook('onRequest', originGuard);
  if (admin) app.addHook('onRequest', adminSite(admin.dir, admin.host));
  app.get('/healthz', async () => ({ ok: true }));
  app.get('/api/auth/me', async () => ({ user: 'public' }));
  app.get('/api/admin/users', async () => ({ users: [] }));
  app.get('/uploads/:id', async () => 'file');
  app.register(fastifyStatic, { root: webDir, wildcard: false, index: ['index.html'] });
  app.setNotFoundHandler((request, reply) => {
    if (request.method !== 'GET' || /^\/(?:api|uploads|ws|admin)(?:[/?]|$)/.test(request.url)) return reply.code(404).send({ error: 'not_found' });
    return reply.sendFile('index.html');
  });
  await app.ready();
  return app;
}

let webDir: string;
let adminDir: string;
const savedAdmin = config.ADMIN_ORIGIN;

before(() => {
  webDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overcord-web-'));
  adminDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overcord-admin-'));
  write(webDir, 'index.html', '<!doctype html><title>Overcord</title>');
  write(webDir, 'sw.js', 'self.skipWaiting()');
  write(adminDir, 'index.html', '<!doctype html><html data-admin-site><script>window.admin = 1</script></html>');
  write(adminDir, 'assets/admin-mark-abc.svg', '<svg/>');
});

after(() => {
  config.ADMIN_ORIGIN = savedAdmin;
  fs.rmSync(webDir, { recursive: true, force: true });
  fs.rmSync(adminDir, { recursive: true, force: true });
});

describe('with ADMIN_URL, the same process serves the admin site on its host', () => {
  let app: FastifyInstance;
  before(async () => {
    config.ADMIN_ORIGIN = ADMIN;
    app = await buildApp(webDir, adminDir);
  });
  after(() => app.close());

  const onAdmin = (url: string) => app.inject({ method: 'GET', url, headers: { host: ADMIN.host } });

  it('serves the admin build, with deep links falling back to its page', async () => {
    for (const url of ['/', '/admin/users/42?tab=moderation']) {
      const response = await onAdmin(url);
      assert.equal(response.statusCode, 200, url);
      assert.match(response.body, /data-admin-site/);
      assert.equal(response.headers['cache-control'], 'no-cache');
    }
    const asset = await onAdmin('/assets/admin-mark-abc.svg');
    assert.equal(asset.statusCode, 200);
    assert.equal(asset.headers['cache-control'], 'public, max-age=31536000, immutable');
  });

  it('gives admin pages a policy for the admin origin and build', async () => {
    const policy = String((await onAdmin('/')).headers['content-security-policy']);
    assert.match(policy, /connect-src 'self' wss:\/\/admin\.example\.com;/);
    assert.ok(!policy.includes('chat.example.com'));
    const appPolicy = String((await app.inject({ method: 'GET', url: '/', headers: { host: APP_HOST } })).headers['content-security-policy']);
    assert.notEqual(appPolicy, policy);
  });

  it('reaches only the admin API, uploads and health checks of the backend', async () => {
    assert.equal((await onAdmin('/api/admin/users')).statusCode, 200);
    assert.equal((await onAdmin('/uploads/abc')).statusCode, 200);
    assert.equal((await onAdmin('/healthz')).statusCode, 200);
    for (const url of ['/api/auth/me', '/api', '/ws/', '/sw.js', '/assets/missing.js', '/api/admin-other']) {
      assert.equal((await onAdmin(url)).statusCode, 404, url);
    }
    const post = await app.inject({ method: 'POST', url: '/', headers: { host: ADMIN.host } });
    assert.equal(post.statusCode, 404);
  });

  it('keeps the public host free of the admin site and its API', async () => {
    const onApp = (url: string) => app.inject({ method: 'GET', url, headers: { host: APP_HOST } });
    assert.equal((await onApp('/admin')).statusCode, 404);
    assert.equal((await onApp('/admin/users')).statusCode, 404);
    assert.equal((await onApp('/api/admin/users')).statusCode, 404);
    assert.equal((await onApp('/sw.js')).statusCode, 200);
    assert.doesNotMatch((await onApp('/app/friends')).body, /data-admin-site/);
  });

  it('refuses the public socket on the admin host', () => {
    assert.equal(isSocketOriginAllowed({ host: ADMIN.host, origin: ADMIN.url }), false);
  });
});

describe('without ADMIN_URL the app starts with the admin site disabled', () => {
  let app: FastifyInstance;
  before(async () => {
    config.ADMIN_ORIGIN = null;
    app = await buildApp(webDir, adminDir);
  });
  after(() => app.close());

  it('answers 404 for the admin API and the retired routes', async () => {
    for (const url of ['/api/admin/users', '/admin', '/admin/users/42?tab=moderation']) {
      const response = await app.inject({ method: 'GET', url, headers: { host: APP_HOST } });
      assert.equal(response.statusCode, 404, url);
    }
    assert.equal((await app.inject({ method: 'GET', url: '/', headers: { host: APP_HOST } })).statusCode, 200);
  });
});
