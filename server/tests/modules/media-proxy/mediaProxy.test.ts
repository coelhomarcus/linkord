import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import type { AddressInfo, LookupFunction } from 'node:net';
import { after, before, describe, it } from 'node:test';
import Fastify from 'fastify';
import sharp from 'sharp';
import {
  createMediaProxy, fetchImage, MAX_IMAGE_BYTES, MediaProxyError, rasterizeSvg, registerMediaProxyRoutes, sniffImageType, USER_RULE, type ProxiedImage, type Upstream,
} from '../../../src/modules/media-proxy/mediaProxy.js';
import { proxiedImageUrl, setMediaProxyKey } from '../../../src/modules/media-proxy/mediaProxyUrls.js';

// A local server is the only thing a test can reach, and the real lookup
// (rightly) refuses loopback, so the permissive one is injected here only.
const allowLoopback: LookupFunction = (_host, options, callback) => {
  if (options.all) return (callback as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [{ address: '127.0.0.1', family: 4 }]);
  callback(null, '127.0.0.1', 4);
};

// a favicon that tries to run script and to read a local file: neither may survive
const HOSTILE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="16" height="16">'
  + '<script>alert(document.cookie)</script><image xlink:href="file:///etc/passwd" width="16" height="16"/><rect width="16" height="16" fill="#f80"/></svg>';

const failsWith = (code: string) => (error: unknown) => error instanceof MediaProxyError && error.code === code;

describe('sniffImageType', () => {
  it('recognizes raster pictures by their bytes', async () => {
    const pixel = sharp({ create: { width: 2, height: 2, channels: 3, background: '#f80' } });
    assert.equal(sniffImageType(await pixel.clone().png().toBuffer()), 'image/png');
    assert.equal(sniffImageType(await pixel.clone().jpeg().toBuffer()), 'image/jpeg');
    assert.equal(sniffImageType(await pixel.clone().webp().toBuffer()), 'image/webp');
    assert.equal(sniffImageType(await pixel.clone().gif().toBuffer()), 'image/gif');
    assert.equal(sniffImageType(Buffer.from([0, 0, 1, 0, 1, 0, 16, 16])), 'image/x-icon');
  });

  it('refuses everything else, SVG included', () => {
    assert.equal(sniffImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')), null);
    assert.equal(sniffImageType(Buffer.from('<!doctype html><html></html>')), null);
    assert.equal(sniffImageType(Buffer.alloc(0)), null);
  });
});

describe('rasterizeSvg', () => {
  it('draws a vector up to 512 px and refuses what is not one', async () => {
    const png = await rasterizeSvg(Buffer.from(HOSTILE_SVG));
    assert.ok(png);
    const { width, height, format } = await sharp(png).metadata();
    assert.deepEqual({ width, height, format }, { width: 512, height: 512, format: 'png' });
    assert.equal(await rasterizeSvg(Buffer.from('<html></html>')), null);
    assert.equal(await rasterizeSvg(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><unclosed')), null);
  });
});

describe('fetchImage', () => {
  let server: http.Server;
  let base: string;
  let png: Buffer;

  before(async () => {
    png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#08f' } }).png().toBuffer();
    server = http.createServer((req, res) => {
      if (req.url === '/cover.png') { res.writeHead(200, { 'content-type': 'image/png' }); res.end(png); return; }
      if (req.url === '/hop') { res.writeHead(302, { location: '/cover.png' }); res.end(); return; }
      if (req.url === '/page') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html></html>'); return; }
      if (req.url === '/icon.svg') { res.writeHead(200, { 'content-type': 'image/svg+xml' }); res.end(HOSTILE_SVG); return; }
      if (req.url === '/not-really.svg') { res.writeHead(200, { 'content-type': 'image/svg+xml' }); res.end('<html><body>hi</body></html>'); return; }
      if (req.url === '/lying.png') { res.writeHead(200, { 'content-type': 'image/png' }); res.end('<svg xmlns="http://www.w3.org/2000/svg"/>'); return; }
      if (req.url === '/declared-huge') { res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(MAX_IMAGE_BYTES + 1) }); res.end(); return; }
      if (req.url === '/streamed-huge') {
        res.writeHead(200, { 'content-type': 'image/png' });
        const chunk = Buffer.alloc(1024 * 1024);
        let sent = 0;
        const pump = () => { while (sent < 8 && res.write(chunk)) sent++; if (sent < 8) res.once('drain', () => { sent++; pump(); }); else res.end(); };
        res.on('error', () => undefined);
        pump();
        return;
      }
      res.writeHead(404); res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
  });
  after(() => { server.closeAllConnections(); server.close(); });

  it('reads a picture, typed from its bytes, with an ETag of its content', async () => {
    const image = await fetchImage({ url: `${base}/cover.png`, redirects: 0 }, allowLoopback);
    assert.deepEqual(image.body, png);
    assert.equal(image.contentType, 'image/png');
    assert.match(image.etag, /^"[A-Za-z0-9_-]{27}"$/);
  });

  it('follows redirects only as far as it was allowed', async () => {
    assert.ok(await fetchImage({ url: `${base}/hop`, redirects: 1 }, allowLoopback));
    await assert.rejects(fetchImage({ url: `${base}/hop`, redirects: 0 }, allowLoopback), failsWith('image_unavailable'));
  });

  it('refuses what is not a picture, by header and by content', async () => {
    await assert.rejects(fetchImage({ url: `${base}/page`, redirects: 0 }, allowLoopback), failsWith('not_an_image'));
    await assert.rejects(fetchImage({ url: `${base}/lying.png`, redirects: 0 }, allowLoopback), failsWith('not_an_image'));
  });

  it('draws an SVG into a PNG instead of passing the document on', async () => {
    const image = await fetchImage({ url: `${base}/icon.svg`, redirects: 0 }, allowLoopback);
    assert.equal(image.contentType, 'image/png');
    assert.equal(sniffImageType(image.body), 'image/png');
    assert.ok(!image.body.includes('script'));
    await assert.rejects(fetchImage({ url: `${base}/not-really.svg`, redirects: 0 }, allowLoopback), failsWith('not_an_image'));
  });

  it('refuses a picture too large, declared or streamed', async () => {
    await assert.rejects(fetchImage({ url: `${base}/declared-huge`, redirects: 0 }, allowLoopback), failsWith('image_too_large'));
    await assert.rejects(fetchImage({ url: `${base}/streamed-huge`, redirects: 0 }, allowLoopback), failsWith('image_too_large'));
  });

  it('turns an upstream error into image_unavailable', async () => {
    await assert.rejects(fetchImage({ url: `${base}/missing.png`, redirects: 0 }, allowLoopback), failsWith('image_unavailable'));
  });

  it('never reaches a private address (SSRF), named or literal', async () => {
    const port = (server.address() as AddressInfo).port;
    await assert.rejects(fetchImage({ url: `http://127.0.0.1:${port}/cover.png`, redirects: 0 }), failsWith('image_unavailable'));
    await assert.rejects(fetchImage({ url: `http://localhost:${port}/cover.png`, redirects: 0 }), failsWith('image_unavailable'));
    await assert.rejects(fetchImage({ url: 'http://169.254.169.254/latest/meta-data', redirects: 0 }), failsWith('image_unavailable'));
  });
});

const picture = (name: string): ProxiedImage => ({ body: Buffer.from(name), contentType: 'image/png', etag: `"${name}"` });

describe('createMediaProxy', () => {
  it('fetches a picture once and serves it from the cache after', async () => {
    let calls = 0;
    const proxy = createMediaProxy({ fetch: async () => { calls++; return picture('a'); } });
    const upstream = { url: 'https://cdn.example/a.png', redirects: 0 };
    assert.equal((await proxy.get('u-cache', upstream)).etag, '"a"');
    assert.equal((await proxy.get('u-other', upstream)).etag, '"a"');
    assert.equal(calls, 1);
  });

  it('shares one fetch between simultaneous requests for the same picture', async () => {
    let calls = 0;
    const proxy = createMediaProxy({ fetch: async () => { calls++; await new Promise((r) => setTimeout(r, 10)); return picture('b'); } });
    const upstream = { url: 'https://cdn.example/b.png', redirects: 0 };
    await Promise.all([proxy.get('u-share', upstream), proxy.get('u-share', upstream), proxy.get('u-share-2', upstream)]);
    assert.equal(calls, 1);
  });

  it('fetches again once the cached copy expires', async () => {
    let now = 0;
    let calls = 0;
    const proxy = createMediaProxy({ fetch: async () => { calls++; return picture('c'); }, now: () => now });
    const upstream = { url: 'https://cdn.example/c.png', redirects: 0 };
    await proxy.get('u-expire', upstream);
    now += 8 * 24 * 60 * 60 * 1000;
    await proxy.get('u-expire', upstream);
    assert.equal(calls, 2);
  });

  it('drops the least recently used pictures once over its byte budget', async () => {
    const big = (name: string): ProxiedImage => ({ body: Buffer.alloc(5 * 1024 * 1024), contentType: 'image/png', etag: `"${name}"` });
    const fetched: string[] = [];
    const proxy = createMediaProxy({ fetch: async ({ url }) => { fetched.push(url); return big(url); } });
    const at = (i: number): Upstream => ({ url: `https://cdn.example/big-${i}.png`, redirects: 0 });
    for (let i = 0; i < 14; i++) await proxy.get('u-budget', at(i));
    assert.ok(proxy.cachedBytes <= 64 * 1024 * 1024);
    await proxy.get('u-budget', at(13));
    assert.equal(fetched.filter((url) => url === at(13).url).length, 1, 'the newest is still cached');
    await proxy.get('u-budget', at(0));
    assert.equal(fetched.filter((url) => url === at(0).url).length, 2, 'the oldest was dropped');
  });

  it('remembers a failure for a while instead of asking again', async () => {
    let now = 0;
    let calls = 0;
    const proxy = createMediaProxy({ fetch: async () => { calls++; throw new MediaProxyError('not_an_image'); }, now: () => now });
    const upstream = { url: 'https://example.com/favicon.ico', redirects: 0 };
    await assert.rejects(proxy.get('u-fail', upstream), failsWith('not_an_image'));
    await assert.rejects(proxy.get('u-fail', upstream), failsWith('not_an_image'));
    assert.equal(calls, 1);
    now += 31 * 60 * 1000;
    await assert.rejects(proxy.get('u-fail', upstream), failsWith('not_an_image'));
    assert.equal(calls, 2);
  });

  it('limits how many uncached pictures one account fetches, but not cache hits', async () => {
    const proxy = createMediaProxy({ fetch: async ({ url }) => picture(url) });
    for (let i = 0; i < USER_RULE.max; i++) await proxy.get('u-limit', { url: `https://cdn.example/l-${i}.png`, redirects: 0 });
    await assert.rejects(proxy.get('u-limit', { url: 'https://cdn.example/one-more.png', redirects: 0 }), (error: unknown) => failsWith('rate_limited')(error) && (error as MediaProxyError).retryAfterMs > 0);
    assert.ok(await proxy.get('u-limit', { url: 'https://cdn.example/l-0.png', redirects: 0 }));
    assert.ok(await proxy.get('u-someone-else', { url: 'https://cdn.example/one-more.png', redirects: 0 }));
  });
});

describe('media proxy routes', () => {
  const requested: Upstream[] = [];
  const png = picture('route');
  let app: ReturnType<typeof Fastify>;
  let off: ReturnType<typeof Fastify>;

  before(async () => {
    setMediaProxyKey(crypto.randomBytes(32));
    const authenticate = async (request: { headers: Record<string, unknown> }) => (typeof request.headers['x-user'] === 'string' ? request.headers['x-user'] : null);
    app = Fastify();
    registerMediaProxyRoutes(app, { authenticate, enabled: true, proxy: createMediaProxy({ fetch: async (upstream) => { requested.push(upstream); return png; } }) });
    off = Fastify();
    registerMediaProxyRoutes(off, { authenticate, enabled: false, proxy: createMediaProxy({ fetch: async () => { throw new Error('must not fetch'); } }) });
    await Promise.all([app.ready(), off.ready()]);
  });
  after(async () => { setMediaProxyKey(null); await Promise.all([app.close(), off.close()]); });

  const get = (url: string, headers: Record<string, string> = { 'x-user': 'u-route' }, server = app) => server.inject({ method: 'GET', url, headers });

  it('is only for signed-in accounts', async () => {
    assert.equal((await get('/api/media-proxy/igdb/cover_big/co1abc', {})).statusCode, 401);
  });

  it('serves an IGDB cover from the fixed host, with cache headers and nosniff', async () => {
    const res = await get('/api/media-proxy/igdb/cover_big/co1abc');
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'image/png');
    assert.equal(res.headers['cache-control'], 'private, max-age=604800');
    assert.equal(res.headers.etag, '"route"');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.deepEqual(res.rawPayload, png.body);
    assert.deepEqual(requested.at(-1), { url: 'https://images.igdb.com/igdb/image/upload/t_cover_big/co1abc.jpg', redirects: 0 });
  });

  it('answers 304 to a browser that already has the same picture', async () => {
    const res = await get('/api/media-proxy/igdb/cover_big/co1abc', { 'x-user': 'u-route', 'if-none-match': 'W/"route"' });
    assert.equal(res.statusCode, 304);
    assert.equal(res.rawPayload.length, 0);
  });

  it('serves a YouTube thumbnail by video id', async () => {
    assert.equal((await get('/api/media-proxy/youtube/dQw4w9WgXcQ')).statusCode, 200);
    assert.equal(requested.at(-1)?.url, 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
  });

  it('serves a signed preview picture, following its redirects', async () => {
    assert.equal((await get(proxiedImageUrl('preview', 'https://example.com/og.png')!)).statusCode, 200);
    assert.deepEqual(requested.at(-1), { url: 'https://example.com/og.png', redirects: 3 });
  });

  it('refuses an unsigned, tampered or foreign address without fetching anything', async () => {
    const before = requested.length;
    const signed = proxiedImageUrl('github', 'https://avatars.githubusercontent.com/u/1?v=4')!;
    const swapped = signed.replace(/u=.+$/, `u=${Buffer.from('https://attacker.example/x.png').toString('base64url')}`);
    for (const url of [
      swapped,
      signed.replace('/github/', '/preview/'),
      signed.replace(/\?.*$/, ''),
      `/api/media-proxy/preview/unsigned?u=${Buffer.from('https://example.com/og.png').toString('base64url')}`,
      '/api/media-proxy/igdb/t_original/co1abc',
      '/api/media-proxy/youtube/not-an-id',
      '/api/media-proxy/other/sig?u=target',
    ]) assert.equal((await get(url)).statusCode, 404, url);
    assert.equal(requested.length, before);
  });

  it('passes an upstream refusal on as an error', async () => {
    const failing = Fastify();
    registerMediaProxyRoutes(failing, { authenticate: async () => 'u-route', enabled: true, proxy: createMediaProxy({ fetch: async () => { throw new MediaProxyError('image_too_large'); } }) });
    const res = await failing.inject({ method: 'GET', url: '/api/media-proxy/igdb/cover_big/co9zzz' });
    assert.equal(res.statusCode, 413);
    assert.equal(res.json().error.code, 'image_too_large');
    await failing.close();
  });

  it('switched off, redirects to the service instead of fetching', async () => {
    const res = await get('/api/media-proxy/igdb/cover_small/co1abc', undefined, off);
    assert.equal(res.statusCode, 302);
    assert.equal(res.headers.location, 'https://images.igdb.com/igdb/image/upload/t_cover_small/co1abc.jpg');
    assert.equal((await get('/api/media-proxy/youtube/bad', undefined, off)).statusCode, 404);
  });
});
