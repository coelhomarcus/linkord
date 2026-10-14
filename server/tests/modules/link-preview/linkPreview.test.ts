import { test, describe, before, after } from 'node:test';
import http from 'node:http';
import type { AddressInfo, LookupFunction } from 'node:net';
import sharp from 'sharp';
import assert from 'node:assert/strict';
import { extractMetaTags, extractFavicon, safeResolve, decodeHtmlEntities, emptyResult, isRateLimited, RATE_LIMIT_MAX, fetchLinkPreviewData, warmLinkPreview } from '../../../src/modules/link-preview/linkPreview.js';

describe('extractMetaTags / extractFavicon', () => {
  const html = `<html><head>
    <title>Fallback title</title>
    <meta property="og:title" content="Real title">
    <meta name="description" content="A description">
    <meta property="og:image" content="/img/thumb.png">
    <meta property="og:video:url" content="https://cdn.example.com/v.mp4">
    <meta name="theme-color" content="#ff8800">
    <link rel="icon" href="/favicon-32.png">
  </head><body></body></html>`;

  test('reads the relevant meta tags (property and name, first occurrence wins)', () => {
    const metas = extractMetaTags(html);
    assert.equal(metas['og:title'], 'Real title');
    assert.equal(metas['description'], 'A description');
    assert.equal(metas['og:image'], '/img/thumb.png');
    assert.equal(metas['theme-color'], '#ff8800');
  });

  test('finds the declared favicon', () => {
    assert.equal(extractFavicon(html), '/favicon-32.png');
  });

  test('with no favicon declared, returns null', () => {
    assert.equal(extractFavicon('<html><head></head></html>'), null);
  });
});

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

describe('decodeHtmlEntities', () => {
  test('decodes common named entities', () => {
    assert.equal(decodeHtmlEntities('Tom &amp; Jerry'), 'Tom & Jerry');
    assert.equal(decodeHtmlEntities('it&#39;s'), "it's");
    assert.equal(decodeHtmlEntities('it&apos;s'), "it's");
  });

  test('decodes decimal and hexadecimal numeric entities', () => {
    assert.equal(decodeHtmlEntities('&#65;&#66;&#67;'), 'ABC');
    assert.equal(decodeHtmlEntities('&#x41;&#x42;'), 'AB');
  });

  test('text with no entity at all passes through unchanged', () => {
    assert.equal(decodeHtmlEntities('no entities here'), 'no entities here');
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
    const out = await fetchLinkPreviewData(`${base}/page`, 'size-user-1', allowLoopback);
    assert.equal(out.image, `${base}/img.png`);
    assert.equal(out.imageWidth, 900);
    assert.equal(out.imageHeight, 300);
  });

  test('returns the size an EXIF-rotated image is displayed at', async () => {
    const out = await fetchLinkPreviewData(`${base}/page-rotated`, 'size-user-2', allowLoopback);
    assert.deepEqual([out.imageWidth, out.imageHeight], [64, 128]);
  });

  test('a page without an image has no size', async () => {
    const out = await fetchLinkPreviewData(`${base}/page-none`, 'size-user-3', allowLoopback);
    assert.equal(out.image, null);
    assert.deepEqual([out.imageWidth, out.imageHeight], [null, null]);
  });

  test('keeps the image url when its size cannot be read (404, SVG, not an image)', async () => {
    for (const [path, file] of [['page-missing', 'nope.png'], ['page-svg', 'logo.svg'], ['page-text', 'notes.txt']] as const) {
      const out = await fetchLinkPreviewData(`${base}/${path}`, `size-user-${path}`, allowLoopback);
      assert.equal(out.image, `${base}/${file}`, path);
      assert.deepEqual([out.imageWidth, out.imageHeight], [null, null], path);
    }
  });

  test('a url that is itself an image comes back as the image, with its size', async () => {
    const out = await fetchLinkPreviewData(`${base}/img.png`, 'size-user-4', allowLoopback);
    assert.equal(out.image, `${base}/img.png`);
    assert.deepEqual([out.imageWidth, out.imageHeight], [900, 300]);
    assert.equal(out.title, null);
    assert.equal(out.siteName, 'localhost');
  });

  test('reads only the start of a huge image', async () => {
    const started = Date.now();
    const out = await fetchLinkPreviewData(`${base}/big.png`, 'size-user-5', allowLoopback);
    assert.deepEqual([out.imageWidth, out.imageHeight], [900, 300]);
    assert.ok(Date.now() - started < 3000, 'must not wait for the whole body');
  });

  test('emptyResult carries no size', () => {
    const out = emptyResult('https://example.com/x');
    assert.deepEqual([out.imageWidth, out.imageHeight], [null, null]);
  });
});

describe('warmLinkPreview', () => {
  const allowLoopback: LookupFunction = (_host, options, callback) => {
    if (options.all) return (callback as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [{ address: '127.0.0.1', family: 4 }]);
    callback(null, '127.0.0.1', 4);
  };
  const refuse: LookupFunction = (_host, _options, callback) => callback(new Error('lookup must not run'), '');
  let server: http.Server;
  let base: string;
  let hits: string[];

  before(async () => {
    hits = [];
    server = http.createServer((req, res) => {
      hits.push(req.url ?? '');
      res.setHeader('content-type', 'text/html');
      res.end('<html><head><title>Aquecido</title></head></html>');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
  });
  after(() => { server.close(); server.closeAllConnections(); });

  test('fetches the first link of a message so the first reader gets it from the cache', async () => {
    await warmLinkPreview(`olha isso ${base}/warm-a e também ${base}/warm-b`, 'warm-user-1', allowLoopback);
    assert.deepEqual(hits.filter((h) => h.startsWith('/warm-')), ['/warm-a']);
    // the reader's own request must not need the network at all
    const cached = await fetchLinkPreviewData(`${base}/warm-a`, 'someone-else', refuse);
    assert.equal(cached.title, 'Aquecido');
  });

  test('leaves video, audio and plain text alone', async () => {
    const before = hits.length;
    await warmLinkPreview(`${base}/clip.mp4`, 'warm-user-2', allowLoopback);
    await warmLinkPreview(`${base}/song.mp3`, 'warm-user-2', allowLoopback);
    await warmLinkPreview('sem link nenhum', 'warm-user-2', allowLoopback);
    assert.equal(hits.length, before);
  });

  test('never throws, even when the sender is rate limited or the lookup fails', async () => {
    for (let i = 0; i <= RATE_LIMIT_MAX; i++) isRateLimited('warm-user-3');
    await warmLinkPreview(`${base}/limited`, 'warm-user-3', allowLoopback);
    await warmLinkPreview('https://nao-existe.invalid/x', 'warm-user-4', refuse);
  });
});
