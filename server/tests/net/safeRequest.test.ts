import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { LookupFunction } from 'node:net';
import { requestSafe } from '../../src/net/safeRequest.js';

// A local server is the only thing a test can reach, and the real lookup
// (rightly) refuses loopback, so the permissive one is injected here only.
const allowLoopback: LookupFunction = (_host, options, callback) => {
  if (options.all) return (callback as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [{ address: '127.0.0.1', family: 4 }]);
  callback(null, '127.0.0.1', 4);
};

const readBody = (res: http.IncomingMessage, resolve: (v: string) => void, reject: (e: Error) => void) => {
  let body = '';
  res.setEncoding('utf8');
  res.on('data', (chunk: string) => { body += chunk; });
  res.on('end', () => resolve(body));
  res.on('error', reject);
};

describe('requestSafe', () => {
  let server: http.Server;
  let base: string;

  before(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/hello') { res.setHeader('content-type', 'text/plain'); res.end('hi'); return; }
      if (req.url === '/a') { res.writeHead(302, { location: '/b' }); res.end(); return; }
      if (req.url === '/b') { res.writeHead(302, { location: '/hello' }); res.end(); return; }
      if (req.url === '/loop') { res.writeHead(302, { location: '/loop' }); res.end(); return; }
      if (req.url === '/gone') { res.writeHead(404); res.end(); return; }
      res.writeHead(500); res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
  });
  after(() => { server.close(); });

  test('hands the response to the handler together with the url it ended on', async () => {
    const out = await requestSafe<{ body: string; finalUrl: string }>(`${base}/hello`, 3, 'text/plain', (res, finalUrl, resolve, reject) => {
      readBody(res, (body) => resolve({ body, finalUrl }), reject);
    }, allowLoopback);
    assert.equal(out.body, 'hi');
    assert.equal(out.finalUrl, `${base}/hello`);
  });

  test('follows redirects and reports the final url', async () => {
    const out = await requestSafe<string>(`${base}/a`, 3, '*/*', (res, finalUrl, resolve) => { res.resume(); resolve(finalUrl); }, allowLoopback);
    assert.equal(out, `${base}/hello`);
  });

  test('gives up after too many redirects', async () => {
    await assert.rejects(
      requestSafe(`${base}/loop`, 3, '*/*', (res, _u, resolve) => { res.resume(); resolve('x'); }, allowLoopback),
      /redirecionamentos demais/,
    );
  });

  test('rejects an error status before the handler runs', async () => {
    let called = false;
    await assert.rejects(
      requestSafe(`${base}/gone`, 3, '*/*', (res, _u, resolve) => { called = true; res.resume(); resolve('x'); }, allowLoopback),
      /status 404/,
    );
    assert.equal(called, false);
  });

  test('rejects anything but http(s)', async () => {
    await assert.rejects(requestSafe('file:///etc/passwd', 3, '*/*', () => {}, allowLoopback), /protocolo não suportado/);
  });

  test('with the default lookup, refuses a hostname that resolves to a private address', async () => {
    await assert.rejects(
      requestSafe(`${base}/hello`, 3, '*/*', (res, _u, resolve) => { res.resume(); resolve('x'); }),
      /destino bloqueado/,
    );
  });

  // Node never calls `lookup` for a URL whose host is already an IP, so the
  // address has to be checked before connecting or the guard is skipped.
  const port = () => new URL(base).port;
  for (const host of ['127.0.0.1', '[::1]', '[::ffff:7f00:1]', '10.0.0.5', '169.254.169.254']) {
    test(`refuses an IP-literal url (${host}) without ever connecting`, async () => {
      await assert.rejects(
        requestSafe(`http://${host}:${port()}/hello`, 3, '*/*', (res, _u, resolve) => { res.resume(); resolve('reached'); }, allowLoopback),
        /destino bloqueado/,
      );
    });
  }

  test('also refuses a redirect that points at an IP literal', async () => {
    const hop = http.createServer((_req, res) => { res.writeHead(302, { location: `http://127.0.0.1:${port()}/hello` }); res.end(); });
    await new Promise<void>((resolve) => hop.listen(0, '127.0.0.1', resolve));
    try {
      await assert.rejects(
        requestSafe(`http://localhost:${(hop.address() as AddressInfo).port}/`, 3, '*/*', (res, _u, resolve) => { res.resume(); resolve('reached'); }, allowLoopback),
        /destino bloqueado/,
      );
    } finally { hop.close(); }
  });
});
