import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalYoutubeUrl, createOembedResolver, OEMBED_PROVIDERS, previewFromOembed, providerFor } from '../../../src/modules/link-preview/oembed.js';
import { canonicalUrl, runResolvers } from '../../../src/modules/link-preview/resolvers.js';
import { emptyResult, type Resolver } from '../../../src/modules/link-preview/preview.js';
import { allowLoopback, startPageServer } from '../../fixtures/pageServerFixture.js';

const provider = (name: string) => OEMBED_PROVIDERS.find((p) => p.name === name)!;

describe('canonicalYoutubeUrl', () => {
  test('turns every form of a video link into one', () => {
    const canonical = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    for (const form of [
      'https://youtu.be/dQw4w9WgXcQ',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&feature=share',
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtube.com/shorts/dQw4w9WgXcQ?si=abc',
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
      'https://www.youtube.com/live/dQw4w9WgXcQ',
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    ]) assert.equal(canonicalYoutubeUrl(new URL(form)).toString(), canonical, form);
  });

  test('keeps the start time, in seconds', () => {
    assert.equal(canonicalYoutubeUrl(new URL('https://youtu.be/dQw4w9WgXcQ?t=1m30s')).toString(), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90');
    assert.equal(canonicalYoutubeUrl(new URL('https://www.youtube.com/watch?t=42&v=dQw4w9WgXcQ')).toString(), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42');
  });

  test('leaves a page that is not a video alone', () => {
    assert.equal(canonicalYoutubeUrl(new URL('https://www.youtube.com/@channel')).toString(), 'https://www.youtube.com/@channel');
  });
});

describe('canonicalUrl', () => {
  test('canonicalises YouTube and strips tracking parameters and the fragment', () => {
    assert.equal(canonicalUrl('https://youtu.be/dQw4w9WgXcQ?utm_source=x'), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    assert.equal(canonicalUrl('https://example.com/a?id=1&utm_medium=social&fbclid=abc#top'), 'https://example.com/a?id=1');
  });

  test('leaves an unparseable url as it is', () => {
    assert.equal(canonicalUrl('not a url'), 'not a url');
  });
});

describe('providerFor', () => {
  test('only the allowlisted providers, and only their content urls', () => {
    assert.equal(providerFor(new URL('https://www.youtube.com/watch?v=dQw4w9WgXcQ'))?.name, 'YouTube');
    assert.equal(providerFor(new URL('https://vimeo.com/76979871'))?.name, 'Vimeo');
    assert.equal(providerFor(new URL('https://soundcloud.com/artist/track'))?.name, 'SoundCloud');
    assert.equal(providerFor(new URL('https://open.spotify.com/track/abc'))?.name, 'Spotify');
    assert.equal(providerFor(new URL('https://x.com/someone/status/123'))?.name, 'X');
    assert.equal(providerFor(new URL('https://twitter.com/someone/status/123'))?.name, 'X');
    assert.equal(providerFor(new URL('https://www.tiktok.com/@someone/video/123'))?.name, 'TikTok');
    assert.equal(providerFor(new URL('https://www.reddit.com/r/sub/comments/abc/title/'))?.name, 'Reddit');
    assert.equal(providerFor(new URL('https://x.com/someone')), null, 'a profile has no oEmbed');
    assert.equal(providerFor(new URL('https://www.youtube.com/@channel')), null);
    assert.equal(providerFor(new URL('https://example.com/oembed')), null);
    assert.equal(providerFor(new URL('https://notyoutube.com/watch?v=dQw4w9WgXcQ')), null);
  });
});

describe('previewFromOembed', () => {
  test('a YouTube video: structured fields, the allowlisted iframe as the player', async () => {
    const out = (await previewFromOembed('https://www.youtube.com/watch?v=dQw4w9WgXcQ', provider('YouTube'), {
      type: 'video', title: 'A video', author_name: 'A channel', author_url: 'https://www.youtube.com/@chan', provider_name: 'YouTube',
      thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg', thumbnail_width: 480, thumbnail_height: 360,
      html: '<iframe width="200" height="113" src="https://www.youtube.com/embed/dQw4w9WgXcQ?feature=oembed" allowfullscreen></iframe>',
    }))!;
    assert.equal(out.type, 'video');
    assert.equal(out.title, 'A video');
    assert.equal(out.authorName, 'A channel');
    assert.equal(out.authorUrl, 'https://www.youtube.com/@chan');
    assert.equal(out.siteName, 'YouTube');
    assert.equal(out.image, 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
    assert.deepEqual([out.imageWidth, out.imageHeight], [480, 360]);
    assert.equal(out.player, 'https://www.youtube.com/embed/dQw4w9WgXcQ?feature=oembed');
    assert.equal(out.video, null);
  });

  test('an X post: the text out of the html, and none of the markup kept', async () => {
    const out = (await previewFromOembed('https://x.com/someone/status/1', provider('X'), {
      type: 'rich', author_name: 'Someone', author_url: 'https://twitter.com/someone', provider_name: 'Twitter',
      html: '<blockquote class="twitter-tweet"><p lang="en">Hello <a href="https://t.co/x">there</a></p>&mdash; Someone</blockquote><script src="https://platform.twitter.com/widgets.js"></script>',
    }))!;
    assert.equal(out.description, 'Hello there');
    assert.equal(out.type, 'link');
    assert.equal(out.player, null);
    assert.ok(!JSON.stringify(out).includes('<'), 'no html survives');
  });

  test('an iframe on a host off the allowlist is not a player', async () => {
    const out = (await previewFromOembed('https://vimeo.com/1', provider('Vimeo'), {
      type: 'video', title: 'V', thumbnail_url: 'https://i.vimeocdn.com/t.jpg', thumbnail_width: 640, thumbnail_height: 360,
      html: '<iframe src="https://evil.example.com/player"></iframe>',
    }))!;
    assert.equal(out.type, 'link');
    assert.equal(out.player, null);
  });

  test('a photo is an image of its own size', async () => {
    const out = (await previewFromOembed('https://example.com/p', provider('Reddit'), { type: 'photo', url: 'https://i.example.com/p.jpg', width: 800, height: 600, title: 'P' }))!;
    assert.deepEqual([out.type, out.image, out.imageWidth, out.imageHeight], ['image', 'https://i.example.com/p.jpg', 800, 600]);
  });

  test('an answer with nothing to show, or not an object, is no preview', async () => {
    assert.equal(await previewFromOembed('https://vimeo.com/1', provider('Vimeo'), { type: 'video', version: '1.0' }), null);
    assert.equal(await previewFromOembed('https://vimeo.com/1', provider('Vimeo'), 'nope'), null);
    assert.equal(await previewFromOembed('https://vimeo.com/1', provider('Vimeo'), [1, 2]), null);
  });
});

describe('oEmbed resolver and the chain', () => {
  let page: Awaited<ReturnType<typeof startPageServer>>;
  let lastQuery: URLSearchParams | null = null;
  before(async () => {
    page = await startPageServer({
      '/oembed': (req, res) => {
        lastQuery = new URL(req.url!, 'http://x').searchParams;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ type: 'rich', author_name: 'Someone', provider_name: 'Twitter', html: '<blockquote><p>Posted text</p></blockquote>' }));
      },
      '/oembed-down': (_req, res) => { res.writeHead(503); res.end(); },
      '/oembed-huge': (_req, res) => { res.setHeader('content-type', 'application/json'); res.end(`{"title":"${'a'.repeat(100 * 1024)}"}`); },
    });
  });
  after(() => page.close());

  const fallback: Resolver = { name: 'fallback', matches: () => true, resolve: async ({ url }) => ({ ...emptyResult(url), title: 'From the page' }) };

  test('asks the provider with the url and its fixed parameters', async () => {
    const resolver = createOembedResolver(() => `${page.base}/oembed`);
    const out = (await resolver.resolve({ url: 'https://x.com/someone/status/1', lookup: allowLoopback }))!;
    assert.equal(out.description, 'Posted text');
    assert.equal(lastQuery!.get('url'), 'https://x.com/someone/status/1');
    assert.equal(lastQuery!.get('dnt'), 'true');
    assert.equal(lastQuery!.get('omit_script'), 'true');
  });

  test('a provider that fails hands over to the next resolver', async () => {
    const chain = [createOembedResolver(() => `${page.base}/oembed-down`), fallback];
    const out = await runResolvers({ url: 'https://x.com/someone/status/1', lookup: allowLoopback }, chain);
    assert.equal(out!.title, 'From the page');
  });

  test('an oversized answer is refused and falls through', async () => {
    const chain = [createOembedResolver(() => `${page.base}/oembed-huge`), fallback];
    const out = await runResolvers({ url: 'https://x.com/someone/status/1', lookup: allowLoopback }, chain);
    assert.equal(out!.title, 'From the page');
  });

  test('a host off the provider list never reaches an oEmbed endpoint', async () => {
    const before = page.hits.get('/oembed') ?? 0;
    const chain = [createOembedResolver(() => `${page.base}/oembed`), fallback];
    await runResolvers({ url: 'https://example.com/post', lookup: allowLoopback }, chain);
    assert.equal(page.hits.get('/oembed') ?? 0, before);
  });

  test('null only when every resolver failed; an empty page stays an empty preview', async () => {
    const failing: Resolver = { name: 'failing', matches: () => true, resolve: async () => { throw new Error('down'); } };
    const empty: Resolver = { name: 'empty', matches: () => true, resolve: async ({ url }) => emptyResult(url) };
    assert.equal(await runResolvers({ url: 'https://example.com' }, [failing]), null);
    assert.deepEqual(await runResolvers({ url: 'https://example.com' }, [failing, empty]), emptyResult('https://example.com'));
  });
});
