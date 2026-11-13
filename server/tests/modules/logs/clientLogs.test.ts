import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import { parseClientLog, registerClientLogRoutes } from '../../../src/modules/logs/clientLogs.js';

describe('parseClientLog', () => {
  it('accepts warn/error with a message and trims the excess', () => {
    const entry = parseClientLog({ level: 'error', message: 'm'.repeat(900), stack: 's'.repeat(9000), url: 'u'.repeat(900), userAgent: 'a'.repeat(900) })!;
    assert.equal(entry.level, 'error');
    assert.ok(entry.message.length <= 501);
    assert.ok(entry.stack!.length <= 4001);
    assert.ok(entry.url!.length <= 301);
    assert.ok(entry.userAgent!.length <= 201);
  });

  it('rejects an out-of-range level (debug/info), missing message, or garbage', () => {
    assert.equal(parseClientLog({ level: 'info', message: 'x' }), null);
    assert.equal(parseClientLog({ level: 'debug', message: 'x' }), null);
    assert.equal(parseClientLog({ level: 'error' }), null);
    assert.equal(parseClientLog({ level: 'error', message: '' }), null);
    assert.equal(parseClientLog({ level: 'error', message: 123 }), null);
  });

  it('flattens control characters in the message so it cannot forge log lines', () => {
    const entry = parseClientLog({ level: 'error', message: 'boom\n12:00:00.000 ERROR [http] fake\r\u2028x\u0000' })!;
    assert.equal(entry.message, 'boom 12:00:00.000 ERROR [http] fake x');
    assert.equal(parseClientLog({ level: 'error', message: '\n\t' }), null);
  });

  it('keeps only the last 5 breadcrumbs, trimmed', () => {
    const entry = parseClientLog({ level: 'warn', message: 'x', breadcrumbs: Array.from({ length: 9 }, (_, i) => `${i}${'z'.repeat(400)}`) })!;
    assert.equal(entry.breadcrumbs!.length, 5);
    assert.ok(entry.breadcrumbs![0]!.startsWith('4'));
    assert.ok(entry.breadcrumbs!.every((b) => b.length <= 201));
  });

  it('context is only kept if it is a small object', () => {
    assert.deepEqual(parseClientLog({ level: 'warn', message: 'x', context: { a: 1 } })!.context, { a: 1 });
    assert.equal(parseClientLog({ level: 'warn', message: 'x', context: [1] })!.context, undefined);
    assert.equal(parseClientLog({ level: 'warn', message: 'x', context: { big: 'z'.repeat(2000) } })!.context, undefined);
  });
});

describe('POST /api/client-logs', () => {
  let app: FastifyInstance;
  const lines: string[] = [];
  const realWrite = process.stderr.write.bind(process.stderr);
  before(async () => {
    app = Fastify();
    registerClientLogRoutes(app);
    await app.ready();
    process.stderr.write = ((chunk: string | Uint8Array) => { lines.push(String(chunk)); return true; }) as typeof process.stderr.write;
  });
  after(async () => {
    process.stderr.write = realWrite;
    await app.close();
  });

  it('records a signed-out error as a warning, marked as coming from the client', async () => {
    lines.length = 0;
    const res = await app.inject({ method: 'POST', url: '/api/client-logs', payload: { level: 'error', message: 'fake server error' } });
    assert.equal(res.statusCode, 204);
    const line = lines.find((l) => l.includes('fake server error'));
    assert.ok(line, 'the record was written');
    assert.match(line, /WARN|"level":"warn"/);
    assert.doesNotMatch(line, /ERROR|"level":"error"/);
    assert.match(line, /\[client\]|"component":"client"/);
    assert.match(line, /reportedLevel/);
  });
});
