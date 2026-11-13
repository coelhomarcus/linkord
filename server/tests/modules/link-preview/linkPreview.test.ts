import { test, describe, before, after, mock } from 'node:test';
import http from 'node:http';
import type { AddressInfo, LookupFunction } from 'node:net';
import sharp from 'sharp';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { isRateLimited, RATE_LIMIT_MAX, fetchLinkPreviewData, withProxiedImages } from '../../../src/modules/link-preview/linkPreview.js';
import { emptyResult, safeResolve } from '../../../src/modules/link-preview/preview.js';
import { setMediaProxyKey } from '../../../src/modules/media-proxy/mediaProxyUrls.js';
import { allowLoopback as loopback, startPageServer } from '../../fixtures/pageServerFixture.js';

describe('safeResolve', () => {
  test('resolves a relative URL against the base', () => {
    assert.equal(safeResolve('/img/thumb.png', 'https://example.com/pagina'), 'https://example.com/img/thumb.png');
  });

  test('keeps an absolute http(s) URL as-is', () => {
    assert.equal(safeResolve('https://cdn.example.com/v.mp4', 'https://example.com'), 'https://cdn.example.com/v.mp4');
  });

  test('rejects dangerous schemes (javascript:, data:) — never lets this become an img/video src', () => {
    assert.equal(safeResolve('javascript:alert(1)', 'https://example.com'), null);
    assert.equal(safeResolve('data:text/html,<script>', 'https://example.com'), null);
  });

  test('null/empty return null without trying to resolve', () => {
    assert.equal(safeResolve(null, 'https://example.com'), null);
    assert.equal(safeResolve('', 'https://example.com'), null);
  });

  test('an invalid base (no http/https protocol to anchor on) returns null', () => {
    assert.equal(safeResolve('/img.png', 'not-a-valid-base'), null);
  });
});

describe('isRateLimited', () => {
  test(`allows exactly ${RATE_LIMIT_MAX} calls in the window, blocks the next one`, () => {
    const userId = `user-${Math.random()}`;
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      assert.equal(isRateLimited(userId), false, `call ${i + 1} should pass`);
    }
    assert.equal(isRateLimited(userId), true);
  });

  test('each user has their own counter — one flooding does not affect the other', () => {
    const userA = `user-a-${Math.random()}`;
    const userB = `user-b-${Math.random()}`;
    for (let i = 0; i < RATE_LIMIT_MAX; i++) isRateLimited(userA);
    assert.equal(isRateLimited(userA), true); // A tripped the limit
    assert.equal(isRateLimited(userB), false); // B was unaffected
  });
});

describe('emptyResult', () => {
  test('uses the hostname (without www.) as the fallback siteName', () => {
    assert.equal(emptyResult('https://www.example.com/pagina').siteName, 'example.com');
  });

  test('a URL that fails to parse still returns a usable object', () => {
    const r = emptyResult('not-a-valid-url');
    assert.equal(r.siteName, 'not-a-valid-url');
    assert.equal(r.title, null);
  });
});

describe('fetchLinkPreviewData — image size', () => {
  const allowLoopback: LookupFunction = (_host, options, callback) => {
    if (options.all) return (callback as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [{ address: '127.0.0.1', family: 4 }]);
    callback(null, '127.0.0.1', 4);
  };
  let server: http.Server;
  let base: string;
  let png: Buffer;
  let rotatedJpeg: Buffer;
  const page = (head: string) => `<html><head><title>T</title>${head}</head><body></body></html>`;

  before(async () => {
    png = await sharp({ create: { width: 900, height: 300, channels: 3, background: '#d33' } }).png().toBuffer();
    // stored 128x64 with EXIF orientation 6: displayed rotated, so 64x128
    rotatedJpeg = await sharp({ create: { width: 128, height: 64, channels: 3, background: '#33d' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    server = http.createServer((req, res) => {
      const html = (body: string) => { res.setHeader('content-type', 'text/html'); res.end(body); };
      switch (req.url) {
        case '/page': return html(page('<meta property="og:image" content="/img.png">'));
        case '/page-rotated': return html(page('<meta property="og:image" content="/rotated.jpg">'));
        case '/page-svg': return html(page('<meta property="og:image" content="/logo.svg">'));
        case '/page-missing': return html(page('<meta property="og:image" content="/nope.png">'));
        case '/page-text': return html(page('<meta property="og:image" content="/notes.txt">'));
        case '/page-none': return html(page(''));
        case '/img.png': res.setHeader('content-type', 'image/png'); return void res.end(png);
        case '/rotated.jpg': res.setHeader('content-type', 'image/jpeg'); return void res.end(rotatedJpeg);
        case '/logo.svg': res.setHeader('content-type', 'image/svg+xml'); return void res.end('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"/>');
        case '/notes.txt': res.setHeader('content-type', 'text/plain'); return void res.end('hello');
        case '/big.png': {
          // a valid header followed by far more data than the probe may read
          res.setHeader('content-type', 'image/png');
          res.write(png);
          const chunk = Buffer.alloc(64 * 1024);
          let sent = 0;
          const pump = () => { while (sent < 16 * 1024 * 1024) { sent += chunk.length; if (!res.write(chunk)) return void res.once('drain', pump); } res.end(); };
          return pump();
        }
        default: res.writeHead(404); res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
  });
  after(() => { server.close(); server.closeAllConnections(); });

  test('measures the page image and returns its size', async () => {
    const out = (await fetchLinkPreviewData(`${base}/page`, 'size-user-1', allowLoopback))!;
    assert.equal(out.image, `${base}/img.png`);
    assert.equal(out.imageWidth, 900);
    assert.equal(out.imageHeight, 300);
  });

  test('returns the size an EXIF-rotated image is displayed at', async () => {
    const out = (await fetchLinkPreviewData(`${base}/page-rotated`, 'size-user-2', allowLoopback))!;
    assert.deepEqual([out.imageWidth, out.imageHeight], [64, 128]);
  });

  test('a page without an image has no size', async () => {
    const out = (await fetchLinkPreviewData(`${base}/page-none`, 'size-user-3', allowLoopback))!;
    assert.equal(out.image, null);
    assert.deepEqual([out.imageWidth, out.imageHeight], [null, null]);
  });

  test('keeps the image url when its size cannot be read (404, SVG, not an image)', async () => {
    for (const [path, file] of [['page-missing', 'nope.png'], ['page-svg', 'logo.svg'], ['page-text', 'notes.txt']] as const) {
      const out = (await fetchLinkPreviewData(`${base}/${path}`, `size-user-${path}`, allowLoopback))!;
      assert.equal(out.image, `${base}/${file}`, path);
      assert.deepEqual([out.imageWidth, out.imageHeight], [null, null], path);
    }
  });

  test('a url that is itself an image comes back as the image, with its size', async () => {
    const out = (await fetchLinkPreviewData(`${base}/img.png`, 'size-user-4', allowLoopback))!;
    assert.equal(out.image, `${base}/img.png`);
    assert.deepEqual([out.imageWidth, out.imageHeight], [900, 300]);
    assert.equal(out.title, null);
    assert.equal(out.siteName, 'localhost');
  });

  test('a url that is itself an SVG comes back as the image, without a size', async () => {
    const out = (await fetchLinkPreviewData(`${base}/logo.svg`, 'size-user-svg', allowLoopback))!;
    assert.equal(out.image, `${base}/logo.svg`);
    assert.deepEqual([out.imageWidth, out.imageHeight], [null, null]);
  });

  test('reads only the start of a huge image', async () => {
    const started = Date.now();
    const out = (await fetchLinkPreviewData(`${base}/big.png`, 'size-user-5', allowLoopback))!;
    assert.deepEqual([out.imageWidth, out.imageHeight], [900, 300]);
    assert.ok(Date.now() - started < 3000, 'must not wait for the whole body');
  });

  test('emptyResult carries no size', () => {
    const out = emptyResult('https://example.com/x');
    assert.deepEqual([out.imageWidth, out.imageHeight], [null, null]);
  });
});

describe('fetchLinkPreviewData — one fetch per url at a time', () => {
  const allowLoopback: LookupFunction = (_host, options, callback) => {
    if (options.all) return (callback as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [{ address: '127.0.0.1', family: 4 }]);
    callback(null, '127.0.0.1', 4);
  };
  let server: http.Server;
  let base: string;
  let hits = 0;
  before(async () => {
    server = http.createServer((_req, res) => {
      hits++;
      setTimeout(() => { res.setHeader('content-type', 'text/html'); res.end('<html><head><title>Uma vez</title></head></html>'); }, 50);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
  });
  after(() => { server.close(); server.closeAllConnections(); });

  test('two callers asking for the same url at once share one fetch', async () => {
    const [a, b] = await Promise.all([
      fetchLinkPreviewData(`${base}/same`, 'dedupe-user-1', allowLoopback),
      fetchLinkPreviewData(`${base}/same`, 'dedupe-user-2', allowLoopback),
    ]);
    assert.equal(hits, 1);
    assert.equal(a!.title, 'Uma vez');
    assert.deepEqual(b, a);
  });

  test('joining a fetch under way does not count against the rate limit', async () => {
    for (let i = 0; i < RATE_LIMIT_MAX; i++) isRateLimited('dedupe-user-3');
    const first = fetchLinkPreviewData(`${base}/joined`, 'dedupe-user-4', allowLoopback);
    // dedupe-user-3 is at its limit, but nothing new is fetched for it
    const joined = await fetchLinkPreviewData(`${base}/joined`, 'dedupe-user-3', allowLoopback);
    assert.deepEqual(joined, await first);
  });
});

describe('withProxiedImages', () => {
  before(() => setMediaProxyKey(crypto.randomBytes(32)));
  after(() => setMediaProxyKey(null));

  test('sends the picture and the favicon through our proxy, and nothing else', () => {
    const stored = { ...emptyResult('https://example.com/post'), title: 'Post', image: 'https://example.com/og.png', video: 'https://example.com/v.mp4', favicon: 'http://example.com/favicon.ico' };
    const sent = withProxiedImages(stored);
    assert.match(sent.image!, /^\/api\/media-proxy\/preview\//);
    assert.match(sent.favicon!, /^\/api\/media-proxy\/preview\//);
    assert.equal(sent.video, 'https://example.com/v.mp4');
    assert.equal(sent.url, 'https://example.com/post');
    assert.equal(stored.image, 'https://example.com/og.png', 'what is stored keeps the original');
  });
});

describe('withProxiedImages — gallery', () => {
  before(() => setMediaProxyKey(crypto.randomBytes(32)));
  after(() => setMediaProxyKey(null));

  test('proxies every picture of the gallery, and leaves a row without one as it was', () => {
    const sent = withProxiedImages({ ...emptyResult('https://example.com/post'), images: ['https://example.com/a.png', 'https://example.com/b.png'] });
    assert.equal(sent.images!.length, 2);
    for (const src of sent.images!) assert.match(src, /^\/api\/media-proxy\/preview\//);
    assert.equal('images' in withProxiedImages(emptyResult('https://example.com/old')), false);
  });
});

describe('fetchLinkPreviewData — cache', () => {
  let page: Awaited<ReturnType<typeof startPageServer>>;
  let flakyUp = false;
  before(async () => {
    page = await startPageServer({
      '/flaky': (_req, res) => {
        if (!flakyUp) { res.writeHead(503); return void res.end(); }
        res.setHeader('content-type', 'text/html');
        res.end('<html><head><title>Back up</title></head></html>');
      },
      '/stable': (_req, res) => { res.setHeader('content-type', 'text/html'); res.end('<html><head><title>Stable</title></head></html>'); },
      '/tracked': (_req, res) => { res.setHeader('content-type', 'text/html'); res.end('<html><head><title>Tracked</title></head></html>'); },
    });
  });
  after(() => { mock.timers.reset(); page.close(); });

  test('a failure is null, kept for a minute, then tried again', async () => {
    mock.timers.enable({ apis: ['Date'], now: Date.now() });
    try {
      assert.equal(await fetchLinkPreviewData(`${page.base}/flaky`, 'cache-user-1', loopback), null);
      flakyUp = true;
      assert.equal(await fetchLinkPreviewData(`${page.base}/flaky`, 'cache-user-1', loopback), null, 'still the cached failure');
      assert.equal(page.hits.get('/flaky'), 1);
      mock.timers.tick(61_000);
      assert.equal((await fetchLinkPreviewData(`${page.base}/flaky`, 'cache-user-1', loopback))!.title, 'Back up');
      assert.equal(page.hits.get('/flaky'), 2);
    } finally {
      mock.timers.reset();
    }
  });

  test('a preview with content is kept for hours', async () => {
    mock.timers.enable({ apis: ['Date'], now: Date.now() });
    try {
      await fetchLinkPreviewData(`${page.base}/stable`, 'cache-user-2', loopback);
      mock.timers.tick(60 * 60 * 1000);
      assert.equal((await fetchLinkPreviewData(`${page.base}/stable`, 'cache-user-2', loopback))!.title, 'Stable');
      assert.equal(page.hits.get('/stable'), 1);
    } finally {
      mock.timers.reset();
    }
  });

  test('links that differ only in tracking parameters share one fetch, each keeping its own url', async () => {
    const a = (await fetchLinkPreviewData(`${page.base}/tracked?utm_source=a`, 'cache-user-3', loopback))!;
    const b = (await fetchLinkPreviewData(`${page.base}/tracked?utm_source=b&fbclid=x`, 'cache-user-3', loopback))!;
    assert.equal(page.hits.get('/tracked'), 1);
    assert.equal(a.url, `${page.base}/tracked?utm_source=a`);
    assert.equal(b.url, `${page.base}/tracked?utm_source=b&fbclid=x`);
    assert.equal(b.title, 'Tracked');
  });
});
