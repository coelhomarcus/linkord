import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ConnectionFetchError, fetchConnectionJson, imageUrl } from '../../src/integrations/connectionHttp.js';

describe('connection HTTP client', () => {
  it('honors rate-limit cooldowns and classifies unavailable or private profiles', async () => {
    for (const [status, code] of [[429, 'rate_limited'], [404, 'not_found'], [503, 'unavailable']] as const) {
      await assert.rejects(fetchConnectionJson('https://example.com', {}, async () => new Response('', { status, headers: { 'retry-after': '120' } })), (error: ConnectionFetchError) => error.code === code && error.retryAfterMs === 120000);
    }
  });
  it('distinguishes private resources from GitHub secondary rate limits', async () => {
    await assert.rejects(fetchConnectionJson('https://example.com', {}, async () => new Response('', { status: 403 })), (error: ConnectionFetchError) => error.code === 'private');
    const limits: Record<string, string>[] = [{ 'retry-after': '60' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.ceil(Date.now() / 1000) + 120) }];
    for (const headers of limits) {
      await assert.rejects(fetchConnectionJson('https://example.com', {}, async () => new Response('', { status: 403, headers })), (error: ConnectionFetchError) => error.code === 'rate_limited' && error.retryAfterMs >= 60000);
    }
  });
  it('rejects malformed JSON, oversized responses, redirects, and transport failures', async () => {
    await assert.rejects(fetchConnectionJson('https://example.com', {}, async () => new Response('bad json')), (error: ConnectionFetchError) => error.code === 'invalid_response');
    await assert.rejects(fetchConnectionJson('https://example.com', {}, async () => new Response('x'.repeat(2 * 1024 * 1024 + 1))), ConnectionFetchError);
    await assert.rejects(fetchConnectionJson('https://example.com', {}, async (_url, init) => { assert.equal(init?.redirect, 'error'); assert.ok(init?.signal); throw new Error('offline'); }), (error: ConnectionFetchError) => error.code === 'unavailable');
    assert.equal(imageUrl('https://attacker.example/track.png', 'cdn.myanimelist.net'), null);
  });
});
