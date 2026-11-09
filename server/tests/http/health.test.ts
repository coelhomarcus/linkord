import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Fastify from 'fastify';
import { registerHealthRoute } from '../../src/http/health.js';

describe('GET /healthz', () => {
  it('answers only { ok: true }, without participants or uptime', async () => {
    const app = Fastify();
    registerHealthRoute(app);
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { ok: true });
    await app.close();
  });
});
