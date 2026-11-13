import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Fastify from 'fastify';
import { createReadinessCheck, registerHealthRoute, type ReadinessDeps } from '../../src/http/health.js';

describe('GET /healthz', () => {
  it('answers only { ok: true }, without participants or uptime', async () => {
    const app = Fastify();
    registerHealthRoute(app);
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { ok: true });
    await app.close();
  });

  it('stays green while readiness fails', async () => {
    const app = Fastify();
    registerHealthRoute(app, async () => false);
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    assert.equal(res.statusCode, 200);
    await app.close();
  });
});

function readyApp(deps: Partial<ReadinessDeps>) {
  const app = Fastify();
  registerHealthRoute(app, createReadinessCheck({
    pingDb: async () => ({ rows: [{ '?column?': 1 }] }),
    unwritableUploadDirs: async () => [],
    timeoutMs: 50,
    cacheMs: 0,
    ...deps,
  }));
  return app;
}

describe('GET /readyz', () => {
  it('answers 200 { ok: true } when the database answers and uploads are writable', async () => {
    const app = readyApp({});
    const res = await app.inject({ method: 'GET', url: '/readyz' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { ok: true });
    assert.equal(res.headers['cache-control'], 'no-store');
    await app.close();
  });

  it('answers 503 with no detail when the query fails', async () => {
    const app = readyApp({ pingDb: async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:5432'); } });
    const res = await app.inject({ method: 'GET', url: '/readyz' });
    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.json(), { ok: false });
    assert.doesNotMatch(res.body, /ECONNREFUSED|5432/);
    await app.close();
  });

  it('answers 503 when the query hangs past the timeout', async () => {
    const app = readyApp({ pingDb: () => new Promise(() => {}) });
    const started = Date.now();
    const res = await app.inject({ method: 'GET', url: '/readyz' });
    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.json(), { ok: false });
    assert.ok(Date.now() - started < 1000);
    await app.close();
  });

  it('answers 503 without naming the folder when uploads are not writable', async () => {
    const app = readyApp({ unwritableUploadDirs: async () => ['/app/uploads/tmp'] });
    const res = await app.inject({ method: 'GET', url: '/readyz' });
    assert.equal(res.statusCode, 503);
    assert.doesNotMatch(res.body, /uploads/);
    await app.close();
  });
});

describe('createReadinessCheck', () => {
  it('reuses a result for the cache window and runs again after it', async () => {
    let pings = 0;
    let clock = 0;
    const check = createReadinessCheck({
      pingDb: async () => { pings++; },
      unwritableUploadDirs: async () => [],
      cacheMs: 5000,
      now: () => clock,
    });
    assert.equal(await check(), true);
    clock = 4999;
    assert.equal(await check(), true);
    assert.equal(pings, 1);
    clock = 5000;
    await check();
    assert.equal(pings, 2);
  });

  it('shares one run between concurrent probes', async () => {
    let pings = 0;
    const check = createReadinessCheck({
      pingDb: async () => { pings++; await new Promise((r) => setTimeout(r, 10)); },
      unwritableUploadDirs: async () => [],
    });
    const results = await Promise.all([check(), check(), check()]);
    assert.deepEqual(results, [true, true, true]);
    assert.equal(pings, 1);
  });

  it('caches a failure too, so a down database is not hammered', async () => {
    let pings = 0;
    const check = createReadinessCheck({
      pingDb: async () => { pings++; throw new Error('down'); },
      unwritableUploadDirs: async () => [],
      now: () => 0,
    });
    assert.equal(await check(), false);
    assert.equal(await check(), false);
    assert.equal(pings, 1);
  });
});
