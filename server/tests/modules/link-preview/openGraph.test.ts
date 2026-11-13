import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { classifyEmbed, collectImages, openGraphResolver } from '../../../src/modules/link-preview/openGraph.js';
import { allowLoopback, html, startPageServer, typed } from '../../fixtures/pageServerFixture.js';

describe('classifyEmbed', () => {
  const none = { twitterCard: null, ogType: null, player: false, video: false, audio: false, image: false };

  test('summary_large_image is an article, a plain summary a link', () => {
    assert.equal(classifyEmbed({ ...none, twitterCard: 'summary_large_image', image: true }), 'article');
    assert.equal(classifyEmbed({ ...none, twitterCard: 'summary', image: true }), 'link');
    assert.equal(classifyEmbed(none), 'link');
  });

  test('a photo card is an image when there is one', () => {
    assert.equal(classifyEmbed({ ...none, twitterCard: 'photo', image: true }), 'image');
    assert.equal(classifyEmbed({ ...none, twitterCard: 'photo' }), 'link');
  });

  test('a player card or a video.* og:type plays only with an allowlisted player', () => {
    assert.equal(classifyEmbed({ ...none, twitterCard: 'player', player: true }), 'video');
    assert.equal(classifyEmbed({ ...none, ogType: 'video.other', player: true }), 'video');
    assert.equal(classifyEmbed({ ...none, twitterCard: 'player' }), 'link');
    assert.equal(classifyEmbed({ ...none, ogType: 'video.movie', image: true, twitterCard: 'summary_large_image' }), 'article');
  });

  test('a checked video or audio file plays', () => {
    assert.equal(classifyEmbed({ ...none, video: true }), 'video');
    assert.equal(classifyEmbed({ ...none, audio: true }), 'audio');
  });
});

describe('collectImages', () => {
  test('resolves, drops non-http(s), merges the http and https twins into the https one', () => {
    assert.deepEqual(
      collectImages(['/a.png', 'http://cdn.example.com/b.png', 'https://cdn.example.com/b.png', 'javascript:alert(1)', '/a.png'], 'https://example.com/post'),
      ['https://example.com/a.png', 'https://cdn.example.com/b.png'],
    );
  });

  test('keeps at most ten', () => {
    const raw = Array.from({ length: 14 }, (_, i) => `/img-${i}.png`);
    assert.equal(collectImages(raw, 'https://example.com').length, 10);
  });
});

describe('openGraphResolver', () => {
  let png: Buffer;
  let page: Awaited<ReturnType<typeof startPageServer>>;
  const head = (inner: string) => `<!doctype html><html><head>${inner}</head><body><meta property="og:title" content="from body"></body></html>`;
  const resolve = (path: string) => openGraphResolver.resolve({ url: `${page.base}${path}`, lookup: allowLoopback });

  before(async () => {
    png = await sharp({ create: { width: 1200, height: 630, channels: 3, background: '#335' } }).png().toBuffer();
    page = await startPageServer({
      '/article': html(head(`
        <title>Tag title</title>
        <meta content="Article title" property="og:title">
        <meta name="description" content="Plain description">
        <meta name="twitter:description" content="Twitter description">
        <meta property="og:image" content="/one.png">
        <meta property="og:image:secure_url" content="/one.png">
        <meta property="og:image" content="/two.png">
        <meta name="twitter:image:src" content="/three.png">
        <meta property="og:image:alt" content="A red square">
        <meta name="twitter:card" content="summary_large_image">
        <meta property="og:site_name" content="The Site">
        <meta name="theme-color" content="#123456">
        <link rel="icon" href="/fav.png">`)),
      '/fallbacks': html(head('<title>Only the tag</title><meta name="twitter:description" content="tw desc">')),
      '/photo': html(head('<meta name="twitter:card" content="photo"><meta property="og:image" content="/one.png">')),
      '/player': html(head('<meta name="twitter:card" content="player"><meta name="twitter:player" content="https://www.youtube.com/embed/abcdefghijk"><meta property="og:image" content="/one.png">')),
      '/player-elsewhere': html(head('<meta name="twitter:card" content="player"><meta name="twitter:player" content="https://player.example.com/embed/1"><meta property="og:title" content="P">')),
      '/og-video-html': html(head('<meta property="og:type" content="video.other"><meta property="og:title" content="V"><meta property="og:video" content="/player-page">')),
      '/og-video-file': html(head('<meta property="og:type" content="video.other"><meta property="og:title" content="V"><meta property="og:video:url" content="/clip">')),
      '/og-audio': html(head('<meta property="og:type" content="music.song"><meta property="og:title" content="S"><meta property="og:audio" content="/song">')),
      '/latin1-header': html(Buffer.from(head('<title>Ação e coração</title>'), 'latin1'), 'text/html; charset=ISO-8859-1'),
      '/latin1-meta': html(Buffer.from(head('<meta charset="iso-8859-1"><meta property="og:title" content="Opinião">'), 'latin1')),
      '/player-page': html('<html><head><title>a player</title></head></html>'),
      '/clip': typed('video/mp4', Buffer.alloc(64)),
      '/song': typed('audio/mpeg', Buffer.alloc(64)),
      '/one.png': typed('image/png', png),
      '/two.png': typed('image/png', png),
      '/three.png': typed('image/png', png),
      '/raw.webm': typed('video/webm', Buffer.alloc(64)),
      '/raw.ogg': typed('audio/ogg', Buffer.alloc(64)),
      '/file.zip': typed('application/zip', Buffer.alloc(64)),
    });
  });
  after(() => page.close());

  test('reads an article: fallbacks, every picture, alt text, type, colours', async () => {
    const out = (await resolve('/article'))!;
    assert.equal(out.title, 'Article title');
    assert.equal(out.description, 'Plain description', 'description beats twitter:description');
    assert.deepEqual(out.images, [`${page.base}/one.png`, `${page.base}/two.png`, `${page.base}/three.png`]);
    assert.equal(out.image, `${page.base}/one.png`);
    assert.deepEqual([out.imageWidth, out.imageHeight], [1200, 630]);
    assert.equal(out.imageAlt, 'A red square');
    assert.equal(out.type, 'article');
    assert.equal(out.siteName, 'The Site');
    assert.equal(out.themeColor, '#123456');
    assert.equal(out.favicon, `${page.base}/fav.png`);
    assert.equal(out.video, null);
    assert.equal(out.player, null);
  });

  test('falls back to <title>, twitter:description and the host', async () => {
    const out = (await resolve('/fallbacks'))!;
    assert.equal(out.title, 'Only the tag');
    assert.equal(out.description, 'tw desc');
    assert.equal(out.siteName, 'localhost');
    assert.equal(out.favicon, `${page.base}/favicon.ico`);
    assert.deepEqual(out.images, []);
    assert.equal(out.imageAlt, null);
    assert.equal(out.type, 'link');
  });

  test('a photo card is an image', async () => {
    assert.equal((await resolve('/photo'))!.type, 'image');
  });

  test('a player card on an allowlisted host is a video with that player', async () => {
    const out = (await resolve('/player'))!;
    assert.equal(out.type, 'video');
    assert.equal(out.player, 'https://www.youtube.com/embed/abcdefghijk');
    assert.equal(out.video, null, 'a player page never goes where a file is expected');
  });

  test('a player card on any other host is a plain link', async () => {
    const out = (await resolve('/player-elsewhere'))!;
    assert.equal(out.type, 'link');
    assert.equal(out.player, null);
  });

  test('an og:video that answers with HTML is dropped', async () => {
    const out = (await resolve('/og-video-html'))!;
    assert.equal(out.video, null);
    assert.equal(out.type, 'link');
  });

  test('an og:video that answers as video is kept', async () => {
    const out = (await resolve('/og-video-file'))!;
    assert.equal(out.video, `${page.base}/clip`);
    assert.equal(out.type, 'video');
  });

  test('an og:audio that answers as audio is kept', async () => {
    const out = (await resolve('/og-audio'))!;
    assert.equal(out.audio, `${page.base}/song`);
    assert.equal(out.type, 'audio');
  });

  test('a latin-1 page reads right, declared in the header or in the page', async () => {
    assert.equal((await resolve('/latin1-header'))!.title, 'Ação e coração');
    assert.equal((await resolve('/latin1-meta'))!.title, 'Opinião');
  });

  test('a url that is a file describes the file', async () => {
    const image = (await resolve('/one.png'))!;
    assert.deepEqual([image.type, image.image, image.imageWidth], ['image', `${page.base}/one.png`, 1200]);
    const video = (await resolve('/raw.webm'))!;
    assert.deepEqual([video.type, video.video], ['video', `${page.base}/raw.webm`]);
    const audio = (await resolve('/raw.ogg'))!;
    assert.deepEqual([audio.type, audio.audio], ['audio', `${page.base}/raw.ogg`]);
    const other = (await resolve('/file.zip'))!;
    assert.deepEqual([other.title, other.image, other.siteName], [null, null, 'localhost']);
  });

  test('a page that cannot be fetched throws, for the chain to fall through', async () => {
    await assert.rejects(resolve('/missing'));
  });
});
