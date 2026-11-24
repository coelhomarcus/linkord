import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import {
  buildContentSecurityPolicy, inlineScriptHashes, inlineStyleHashes, livekitSources, readBuildScriptHashes,
  readBuildStyleHashes, securityHeaders, themeBootstrapStyleHashes, type PolicyInput,
} from '../../src/http/securityHeaders.js';
import { PLAYER_HOSTS } from '../../src/modules/link-preview/playerHosts.js';

const base: PolicyInput = { appUrl: 'https://chat.example.com', livekitUrl: '', klipyEnabled: false, mediaProxyEnabled: true, scriptHashes: [], styleHashes: [] };
const ROOT = path.resolve(import.meta.dirname, '../../..');

/** directive name -> its sources */
function directives(policy: string): Map<string, string[]> {
  return new Map(policy.split(';').map((part) => part.trim().split(/\s+/)).map(([name, ...sources]) => [name!, sources]));
}

const sha256 = (text: string) => `sha256-${crypto.createHash('sha256').update(text, 'utf8').digest('base64')}`;

describe('buildContentSecurityPolicy', () => {
  it('runs only our own scripts and allows neither eval nor WebAssembly', () => {
    const scriptSrc = directives(buildContentSecurityPolicy(base)).get('script-src');
    assert.deepEqual(scriptSrc, ["'self'"]);
  });

  it('adds the inline script hashes of the build', () => {
    const scriptSrc = directives(buildContentSecurityPolicy({ ...base, scriptHashes: ['sha256-abc', 'sha256-def'] })).get('script-src');
    assert.deepEqual(scriptSrc, ["'self'", "'sha256-abc'", "'sha256-def'"]);
  });

  it('allows inline style attributes, and style elements only by hash', () => {
    const policy = buildContentSecurityPolicy({ ...base, styleHashes: ['sha256-abc'] });
    const parsed = directives(policy);
    assert.deepEqual(parsed.get('style-src'), ["'self'"]);
    assert.deepEqual(parsed.get('style-src-elem'), ["'self'", "'sha256-abc'"]);
    assert.deepEqual(parsed.get('style-src-attr'), ["'unsafe-inline'"]);
    assert.equal(policy.match(/unsafe-inline/g)?.length, 1);
    assert.equal(parsed.get('style-src-elem')!.includes("'unsafe-inline'"), false);
  });

  it('refuses to be framed and locks down base, forms and plugins', () => {
    const policy = directives(buildContentSecurityPolicy(base));
    assert.deepEqual(policy.get('frame-ancestors'), ["'none'"]);
    assert.deepEqual(policy.get('object-src'), ["'none'"]);
    assert.deepEqual(policy.get('base-uri'), ["'self'"]);
    assert.deepEqual(policy.get('form-action'), ["'self'"]);
  });

  it('frames only the players on the link-preview allowlist, with their subdomains', () => {
    const frames = directives(buildContentSecurityPolicy(base)).get('frame-src')!;
    assert.deepEqual(frames, PLAYER_HOSTS.flatMap((domain) => [`https://${domain}`, `https://*.${domain}`]));
    // where the players really live
    for (const source of ['https://*.youtube.com', 'https://*.twitch.tv', 'https://*.vimeo.com', 'https://*.soundcloud.com', 'https://streamable.com']) {
      assert.ok(frames.includes(source), source);
    }
    assert.equal(frames.some((source) => !source.startsWith('https://')), false);
  });

  it('connects to the socket, LiveKit and KLIPY only when they are configured', () => {
    assert.deepEqual(directives(buildContentSecurityPolicy(base)).get('connect-src'), ["'self'", 'wss://chat.example.com']);
    const connect = directives(buildContentSecurityPolicy({ ...base, livekitUrl: 'wss://lk.example.com', klipyEnabled: true })).get('connect-src');
    assert.deepEqual(connect, ["'self'", 'wss://chat.example.com', 'wss://lk.example.com', 'https://lk.example.com', 'https://api.klipy.com']);
  });

  it('loads pictures only from the app and KLIPY while the media proxy is on', () => {
    assert.deepEqual(directives(buildContentSecurityPolicy(base)).get('img-src'), ["'self'", 'data:', 'blob:', 'https://*.klipy.com']);
    const local = directives(buildContentSecurityPolicy({ ...base, appUrl: 'http://localhost:8080' }));
    assert.deepEqual(local.get('img-src'), ["'self'", 'data:', 'blob:', 'https://*.klipy.com']);
  });

  it('loads pictures from anywhere when the media proxy only redirects', () => {
    const img = directives(buildContentSecurityPolicy({ ...base, mediaProxyEnabled: false })).get('img-src')!;
    assert.ok(img.includes('https:'));
    assert.ok(!img.includes('http:'));
  });

  it('allows remote http media only when the app itself is served over http', () => {
    assert.ok(!directives(buildContentSecurityPolicy(base)).get('media-src')!.includes('http:'));
    const local = directives(buildContentSecurityPolicy({ ...base, appUrl: 'http://localhost:8080' }));
    assert.ok(local.get('media-src')!.includes('http:'));
    assert.ok(directives(buildContentSecurityPolicy({ ...base, appUrl: 'http://localhost:8080', mediaProxyEnabled: false })).get('img-src')!.includes('http:'));
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

describe('inline style hashes', () => {
  it('hashes the exact text of each inline style', () => {
    const body = '\n      html, body { background: #000; }\n    ';
    const html = `<head><style>${body}</style><style></style><link rel="stylesheet" href="/assets/app.css"></head>`;
    assert.deepEqual(inlineStyleHashes(html), [sha256(body)]);
  });

  it('hashes each theme background the bootstrap can write, and nothing else', () => {
    const html = "var shells = { black: '#000000', old: '#0d0d0f', graphite: '#202225' };\nvar style = document.createElement('style');";
    assert.deepEqual(themeBootstrapStyleHashes(html), [
      sha256('html,body{background:#000000}'),
      sha256('html,body{background:#0d0d0f}'),
      sha256('html,body{background:#202225}'),
    ]);
    assert.deepEqual(themeBootstrapStyleHashes('<style>html{}</style>'), []);
  });

  it('reads the pages and the build manifest that ship with the app', () => {
    const index = fs.readFileSync(path.join(ROOT, 'web/index.html'), 'utf8');
    const offline = fs.readFileSync(path.join(ROOT, 'web/public/offline.html'), 'utf8');
    assert.match(index, /'html,body\{background:' \+ bg \+ '}'/);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linkord-styles-'));
    fs.writeFileSync(path.join(dir, 'index.html'), index);
    fs.writeFileSync(path.join(dir, 'offline.html'), offline);
    fs.writeFileSync(path.join(dir, 'csp-style-sources.json'), JSON.stringify({ sources: ['h1{color:blue}', '', 4] }));
    try {
      const hashes = readBuildStyleHashes(dir);
      for (const color of ['#000000', '#0d0d0f', '#202225']) assert.ok(hashes.includes(sha256(`html,body{background:${color}}`)));
      for (const hash of inlineStyleHashes(offline)) assert.ok(hashes.includes(hash));
      assert.ok(hashes.includes(sha256('h1{color:blue}')));
      assert.equal(hashes.includes(sha256('')), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    assert.deepEqual(readBuildStyleHashes(path.join(dir, 'missing')), []);
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
    fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html><html><head><script>${inline}</script><style>body{color:red}</style></head><body></body></html>`);
    fs.writeFileSync(path.join(dir, 'csp-style-sources.json'), '{not json');
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
    assert.ok(policy.includes(`'${sha256('body{color:red}')}'`));
    assert.match(policy, /style-src-elem 'self'/);
    assert.equal(policy.includes('style-src-attr'), true);
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
