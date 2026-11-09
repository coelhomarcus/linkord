import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import { parseCspReports, registerCspReportRoutes } from '../../../src/modules/logs/cspReports.js';

describe('parseCspReports', () => {
  it('reads a report-uri report and strips the query from URLs', () => {
    const [violation, ...rest] = parseCspReports({
      'csp-report': {
        'document-uri': 'https://chat.example.com/app?token=secret',
        'violated-directive': "script-src-elem 'self'",
        'effective-directive': 'script-src-elem',
        'blocked-uri': 'https://evil.example.net/x.js?k=v#f',
        'source-file': 'https://chat.example.com/assets/index.js',
        'line-number': 12,
        disposition: 'enforce',
      },
    });
    assert.equal(rest.length, 0);
    assert.deepEqual(violation, {
      directive: 'script-src-elem',
      blocked: 'https://evil.example.net/x.js',
      document: 'https://chat.example.com/app',
      source: 'https://chat.example.com/assets/index.js',
      line: 12,
      disposition: 'enforce',
      sample: undefined,
    });
  });

  it('reads a Reporting API batch and ignores other report types', () => {
    const violations = parseCspReports([
      { type: 'csp-violation', url: 'https://chat.example.com/', body: { effectiveDirective: 'img-src', blockedURL: 'inline', disposition: 'report', sample: 'x' } },
      { type: 'deprecation', body: { id: 'x' } },
      { type: 'csp-violation', body: { effectiveDirective: 'connect-src', blockedURL: 'data:text/plain,hi' } },
    ]);
    assert.equal(violations.length, 2);
    assert.equal(violations[0]!.document, 'https://chat.example.com/');
    assert.equal(violations[0]!.blocked, 'inline');
    assert.equal(violations[1]!.blocked, 'data:…');
  });

  it('caps a batch and cuts long fields', () => {
    const entry = { type: 'csp-violation', body: { effectiveDirective: 'img-src', sample: 's'.repeat(2000) } };
    const violations = parseCspReports(Array.from({ length: 50 }, () => entry));
    assert.equal(violations.length, 10);
    assert.ok(violations[0]!.sample!.length <= 301);
  });

  it('garbage yields nothing', () => {
    for (const payload of [null, 'x', 42, {}, { 'csp-report': 'x' }, { 'csp-report': {} }, [null, 1, { type: 'csp-violation' }]]) {
      assert.deepEqual(parseCspReports(payload), []);
    }
  });
});

describe('POST /api/csp-reports', () => {
  let app: FastifyInstance;
  before(async () => {
    app = Fastify();
    registerCspReportRoutes(app);
    await app.ready();
  });
  after(() => app.close());

  it('accepts both report content types', async () => {
    const legacy = await app.inject({
      method: 'POST', url: '/api/csp-reports', headers: { 'content-type': 'application/csp-report' },
      payload: JSON.stringify({ 'csp-report': { 'effective-directive': 'img-src', 'blocked-uri': 'https://x.example/a.png' } }),
    });
    assert.equal(legacy.statusCode, 204);
    const batch = await app.inject({
      method: 'POST', url: '/api/csp-reports', headers: { 'content-type': 'application/reports+json' },
      payload: JSON.stringify([{ type: 'csp-violation', body: { effectiveDirective: 'img-src' } }]),
    });
    assert.equal(batch.statusCode, 204);
  });

  it('a malformed body is not an error', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/csp-reports', headers: { 'content-type': 'application/csp-report' }, payload: '{nope' });
    assert.equal(response.statusCode, 204);
  });
});
