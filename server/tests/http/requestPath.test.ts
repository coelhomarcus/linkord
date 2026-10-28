import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { FastifyRequest } from 'fastify';
import { loggablePath } from '../../src/http/requestPath.js';

const request = (url: string, route?: string) => ({ url, routeOptions: { url: route } }) as unknown as FastifyRequest;

describe('loggablePath', () => {
  it("a matched route logs its pattern, never the request's values", () => {
    assert.equal(loggablePath(request('/api/webhooks/abc/s3cret', '/api/webhooks/:webhookId/:token')), '/api/webhooks/:webhookId/:token');
  });

  it('an unmatched webhook path keeps the id but loses whatever follows it', () => {
    assert.equal(loggablePath(request('/api/webhooks/abc/s3cret/extra?x=1')), '/api/webhooks/abc/[redacted]');
    assert.equal(loggablePath(request('/api/webhooks/abc')), '/api/webhooks/abc');
  });

  it('any other unmatched path loses only its query string', () => {
    assert.equal(loggablePath(request('/api/nope?token=1')), '/api/nope');
  });
});
