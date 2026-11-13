import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Fastify from 'fastify';
import { handleRouteError } from '../../src/http/errorHandler.js';
import { jsonBody } from '../../src/http/respond.js';
import { RateLimitUnavailableError } from '../../src/modules/auth/ratelimit.js';

function appThrowing(err: () => unknown) {
  const app = Fastify({ logger: false });
  app.setErrorHandler(handleRouteError);
  app.get('/boom', async () => { throw err(); });
  app.post('/json', async (request) => jsonBody(request.body));
  return app;
}

describe('route error handler', () => {
  it('answers an unexpected 500 with a generic body and the request id, never the internal message', async () => {
    const sql = 'Failed query: select "id" from "messages" where "messages"."id" < $1\nparams: 99999999999';
    const app = appThrowing(() => new Error(sql));
    const res = await app.inject({ method: 'GET', url: '/boom' });
    assert.equal(res.statusCode, 500);
    const body = res.json();
    assert.equal(body.error.code, 'internal_error');
    assert.equal(body.error.message, 'Erro interno.');
    assert.equal(typeof body.error.requestId, 'string');
    assert.ok(!res.body.includes('messages'), res.body);
    assert.ok(!res.body.includes('99999999999'), res.body);
    await app.close();
  });

  it('hides the message of an error that set a 5xx status itself', async () => {
    const app = appThrowing(() => Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:7880'), { statusCode: 503, code: 'livekit_down' }));
    const res = await app.inject({ method: 'GET', url: '/boom' });
    assert.equal(res.statusCode, 500);
    assert.equal(res.json().error.code, 'internal_error');
    assert.ok(!res.body.includes('ECONNREFUSED'));
    await app.close();
  });

  it('keeps the code and message of a 4xx thrown on purpose', async () => {
    const app = appThrowing(() => new Error('unused'));
    const res = await app.inject({ method: 'POST', url: '/json', payload: [1], headers: { 'content-type': 'application/json' } });
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.json(), { error: { code: 'invalid_json', message: 'Corpo deve ser um objeto JSON.' } });
    await app.close();
  });

  it("keeps Fastify's own body errors", async () => {
    const app = appThrowing(() => new Error('unused'));
    const res = await app.inject({ method: 'POST', url: '/json', payload: '{not json', headers: { 'content-type': 'application/json' } });
    assert.equal(res.statusCode, 400);
    assert.match(res.json().error.code, /^FST_ERR_/);
    await app.close();
  });

  it('refuses with 503 when the attempt counters are unavailable', async () => {
    const app = appThrowing(() => new RateLimitUnavailableError(new Error('database down')));
    const res = await app.inject({ method: 'GET', url: '/boom' });
    assert.equal(res.statusCode, 503);
    assert.equal(res.headers['retry-after'], '30');
    assert.equal(res.json().error.code, 'rate_limit_unavailable');
    await app.close();
  });
});
