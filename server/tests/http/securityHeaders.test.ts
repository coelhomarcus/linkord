import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import {
  buildContentSecurityPolicy, inlineScriptHashes, livekitSources, readBuildScriptHashes, securityHeaders, type PolicyInput,
} from '../../src/http/securityHeaders.js';

const base: PolicyInput = { appUrl: 'https://chat.example.com', livekitUrl: '', klipyEnabled: false, scriptHashes: [] };

/** directive name -> its sources */
function directives(policy: string): Map<string, string[]> {
  return new Map(policy.split(';').map((part) => part.trim().split(/\s+/)).map(([name, ...sources]) => [name!, sources]));
}

const sha256 = (text: string) => `sha256-${crypto.createHash('sha256').update(text, 'utf8').digest('base64')}`;

describe('buildContentSecurityPolicy', () => {
  it('runs only our own scripts, compiles WebAssembly, and allows no eval', () => {
    const scriptSrc = directives(buildContentSecurityPolicy(base)).get('script-src');
    assert.deepEqual(scriptSrc, ["'self'", "'wasm-unsafe-eval'"]);
  });

  it('adds the inline script hashes of the build', () => {
    const scriptSrc = directives(buildContentSecurityPolicy({ ...base, scriptHashes: ['sha256-abc', 'sha256-def'] })).get('script-src');
    assert.deepEqual(scriptSrc, ["'self'", "'wasm-unsafe-eval'", "'sha256-abc'", "'sha256-def'"]);
  });

  it('refuses to be framed and locks down base, forms and plugins', () => {
    const policy = directives(buildContentSecurityPolicy(base));
    assert.deepEqual(policy.get('frame-ancestors'), ["'none'"]);
    assert.deepEqual(policy.get('object-src'), ["'none'"]);
    assert.deepEqual(policy.get('base-uri'), ["'self'"]);
    assert.deepEqual(policy.get('form-action'), ["'self'"]);
  });

  it('frames only the YouTube and Twitch players', () => {
    assert.deepEqual(directives(buildContentSecurityPolicy(base)).get('frame-src'), ['https://www.youtube.com', 'https://player.twitch.tv', 'https://clips.twitch.tv']);
  });

  it('connects to the socket, LiveKit and KLIPY only when they are configured', () => {
    assert.deepEqual(directives(buildContentSecurityPolicy(base)).get('connect-src'), ["'self'", 'wss://chat.example.com']);
    const connect = directives(buildContentSecurityPolicy({ ...base, livekitUrl: 'wss://lk.example.com', klipyEnabled: true })).get('connect-src');
    assert.deepEqual(connect, ["'self'", 'wss://chat.example.com', 'wss://lk.example.com', 'https://lk.example.com', 'https://api.klipy.com']);
  });

  it('allows remote http media only when the app itself is served over http', () => {
    assert.ok(!directives(buildContentSecurityPolicy(base)).get('img-src')!.includes('http:'));
    const local = directives(buildContentSecurityPolicy({ ...base, appUrl: 'http://localhost:8080' }));
    assert.ok(local.get('img-src')!.includes('http:'));
    assert.ok(local.get('media-src')!.includes('http:'));
    assert.deepEqual(local.get('connect-src'), ["'self'", 'ws://localhost:8080']);
  });

  it('survives an empty or broken APP_URL', () => {
    const policy = directives(buildContentSecurityPolicy({ ...base, appUrl: '' }));
    assert.deepEqual(policy.get('connect-src'), ["'self'"]);
    assert.ok(!policy.get('img-src')!.includes('http:'));
  });

  it('reports to the app, through the Reporting API only over https', () => {
    const secure = directives(buildContentSecurityPolicy(base));
    assert.deepEqual(secure.get('report-uri'), ['/api/csp-reports']);
    assert.deepEqual(secure.get('report-to'), ['csp']);
    // over http Chrome would drop the endpoint and, seeing report-to, never fall back to report-uri
    const plain = directives(buildContentSecurityPolicy({ ...base, appUrl: 'http://localhost:8080' }));
    assert.deepEqual(plain.get('report-uri'), ['/api/csp-reports']);
    assert.equal(plain.has('report-to'), false);
  });
});

describe('livekitSources', () => {
  it('a self-hosted server is allowed by its exact host, over ws and http', () => {
    assert.deepEqual(livekitSources('ws://lk.localhost:7880'), ['ws://lk.localhost:7880', 'http://lk.localhost:7880']);
    assert.deepEqual(livekitSources('https://media.example.com'), ['wss://media.example.com', 'https://media.example.com']);
  });

  it('LiveKit Cloud is allowed across its regional hosts', () => {
    assert.deepEqual(livekitSources('wss://my-project-abc.livekit.cloud'), ['wss://*.livekit.cloud', 'https://*.livekit.cloud']);
  });

  it('nothing when LiveKit is not configured', () => {
    assert.deepEqual(livekitSources(''), []);
  });
});

describe('inlineScriptHashes', () => {
  it('hashes the exact text of each inline script and skips external ones', () => {
    const first = "\n      (function () { document.title = 'x'; }());\n    ";
    const html = `<head><script>${first}</script><script type="module" crossorigin src="/assets/index.js"></script></head>`
      + '<body><script type="text/javascript">a()</script><script></script></body>';
    assert.deepEqual(inlineScriptHashes(html), [sha256(first), sha256('a()')]);
  });
});

describe('security headers on responses', () => {
  let dir: string;
  let app: FastifyInstance;
  const inline = "document.documentElement.lang = 'pt-BR';";

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linkord-csp-'));
    fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html><html><head><script>${inline}</script></head><body></body></html>`);
    app = Fastify();
    app.addHook('onRequest', securityHeaders(dir));
    app.get('/api/thing', async () => ({ ok: true }));
    app.register(fastifyStatic, { root: dir, wildcard: false, index: ['index.html'] });
    app.setNotFoundHandler((_request, reply) => reply.sendFile('index.html'));
    await app.ready();
  });

  after(async () => {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('the page carries the full policy, with the build\'s inline script allowed', async () => {
    const response = await app.inject({ method: 'GET', url: '/' });
    assert.equal(response.statusCode, 200);
    const policy = String(response.headers['content-security-policy']);
    assert.match(policy, /frame-ancestors 'none'/);
    assert.ok(policy.includes(`'${sha256(inline)}'`));
    assert.equal(response.headers['x-frame-options'], 'DENY');
  });

  it('a deep link that falls back to the page carries it too', async () => {
    const response = await app.inject({ method: 'GET', url: '/app/friends' });
    assert.match(String(response.headers['content-security-policy']), /script-src 'self'/);
    assert.equal(response.headers['x-frame-options'], 'DENY');
  });

  it('the API gets a policy that loads nothing', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/thing' });
    assert.equal(response.headers['content-security-policy'], "default-src 'none'; frame-ancestors 'none'");
    assert.equal(response.headers['x-frame-options'], 'DENY');
  });

  it('HSTS only over https', async () => {
    const plain = await app.inject({ method: 'GET', url: '/' });
    assert.equal(plain.headers['strict-transport-security'], undefined);
  });

  it('a build without the page still starts, with no hashes', () => {
    assert.deepEqual(readBuildScriptHashes(path.join(dir, 'missing')), []);
  });
});
