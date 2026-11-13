import { firstIframeSrc, firstParagraphText, plainText } from './htmlMeta.js';
import { fetchJson, probeImageSize } from './pageFetch.js';
import { emptyResult, hostMatches, isAllowlistedPlayer, safeResolve, type EmbedType, type LinkPreviewResult, type Resolver } from './preview.js';

// oEmbed for a fixed list of providers. Their pages are scripts that render
// in the browser (X, TikTok) or are huge (YouTube's head is ~700KB), while
// their oEmbed answer is a few hundred bytes of structured fields.
//
// Only those fields are kept. The provider's `html` is never stored or
// rendered: the text of an X or Reddit post is read out of it as plain text,
// and an `<iframe>` in it only counts as a player when its host is on the
// player allowlist (preview.ts). Discovery from a page's own
// `<link type="application/json+oembed">` is not done: only these endpoints
// are ever asked.

interface Provider {
  name: string;
  hosts: readonly string[];
  endpoint: string;
  params?: Record<string, string>;
  /** narrower than the host: the URLs this provider has an oEmbed for */
  matches?: (url: URL) => boolean;
  transform?: (url: URL) => URL;
  /** what a playable embed of this provider is */
  plays?: Exclude<EmbedType, 'link' | 'article' | 'image'>;
  /** the post's text lives in the html's first paragraph */
  textFromHtml?: boolean;
}

const YOUTUBE_HOSTS = ['youtube.com', 'youtube-nocookie.com', 'youtu.be'];
const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_PATH_RE = /^\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})(?:[/?#]|$)/;

function youtubeVideoId(url: URL): string | null {
  if (hostMatches(url.hostname, ['youtu.be'])) {
    const id = url.pathname.split('/')[1] ?? '';
    return YOUTUBE_ID_RE.test(id) ? id : null;
  }
  if (url.pathname === '/watch') {
    const id = url.searchParams.get('v') ?? '';
    return YOUTUBE_ID_RE.test(id) ? id : null;
  }
  return YOUTUBE_PATH_RE.exec(url.pathname)?.[1] ?? null;
}

/** Seconds from a YouTube `t`/`start` (`90`, `90s`, `1m30s`, `1h2m3s`), or null. */
function youtubeStartSeconds(url: URL): number | null {
  const raw = url.searchParams.get('t') ?? url.searchParams.get('start');
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return Number(raw) || null;
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(raw);
  if (!m || !m[0]) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) || null;
}

/** Every form of a YouTube video link (youtu.be, shorts, embed, live, m.,
 * nocookie) as one: `https://www.youtube.com/watch?v=<id>[&t=<seconds>]`. */
export function canonicalYoutubeUrl(url: URL): URL {
  const id = youtubeVideoId(url);
  if (!id) return url;
  const canonical = new URL('https://www.youtube.com/watch');
  canonical.searchParams.set('v', id);
  const start = youtubeStartSeconds(url);
  if (start) canonical.searchParams.set('t', String(start));
  return canonical;
}

export const OEMBED_PROVIDERS: readonly Provider[] = [
  {
    name: 'YouTube', hosts: YOUTUBE_HOSTS, endpoint: 'https://www.youtube.com/oembed', params: { format: 'json' },
    matches: (url) => youtubeVideoId(url) !== null, transform: canonicalYoutubeUrl, plays: 'video',
  },
  { name: 'Vimeo', hosts: ['vimeo.com'], endpoint: 'https://vimeo.com/api/oembed.json', plays: 'video' },
  { name: 'SoundCloud', hosts: ['soundcloud.com'], endpoint: 'https://soundcloud.com/oembed', params: { format: 'json' }, plays: 'audio' },
  { name: 'Spotify', hosts: ['spotify.com'], endpoint: 'https://open.spotify.com/oembed' },
  {
    name: 'X', hosts: ['x.com', 'twitter.com'], endpoint: 'https://publish.x.com/oembed',
    // dnt: don't let X use the embed for personalisation; omit_script: no widgets.js in the answer
    params: { dnt: 'true', omit_script: 'true' },
    matches: (url) => /^\/[^/]+\/status\/\d+/.test(url.pathname), textFromHtml: true,
  },
  { name: 'TikTok', hosts: ['tiktok.com'], endpoint: 'https://www.tiktok.com/oembed', matches: (url) => /\/video\/\d+/.test(url.pathname) },
  { name: 'Reddit', hosts: ['reddit.com'], endpoint: 'https://www.reddit.com/oembed', matches: (url) => url.pathname.includes('/comments/'), textFromHtml: true },
];

export function providerFor(url: URL): Provider | null {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  return OEMBED_PROVIDERS.find((p) => hostMatches(url.hostname, p.hosts) && (!p.matches || p.matches(url))) ?? null;
}

function field(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function dimension(data: Record<string, unknown>, key: string): number | null {
  const value = Number(data[key]);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

/** An oEmbed answer as a preview, or null when it says nothing worth a card. */
export async function previewFromOembed(url: string, provider: Provider, data: unknown, lookup?: Parameters<typeof probeImageSize>[1]): Promise<LinkPreviewResult | null> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const answer = data as Record<string, unknown>;
  const kind = field(answer, 'type');
  const html = field(answer, 'html');
  const photo = kind === 'photo' ? safeResolve(field(answer, 'url'), url) : null;
  const thumbnail = safeResolve(field(answer, 'thumbnail_url'), url);
  const image = photo ?? thumbnail;
  const iframe = html ? safeResolve(firstIframeSrc(html), url) : null;
  const player = isAllowlistedPlayer(iframe) ? iframe : null;
  const title = field(answer, 'title');
  const rawDescription = field(answer, 'description');
  const description = (rawDescription && plainText(rawDescription)) ?? (html && provider.textFromHtml ? firstParagraphText(html) : null);
  if (!title && !description && !image) return null;

  let width = photo ? dimension(answer, 'width') : dimension(answer, 'thumbnail_width');
  let height = photo ? dimension(answer, 'height') : dimension(answer, 'thumbnail_height');
  if (image && (!width || !height)) {
    const size = await probeImageSize(image, lookup);
    width = size?.width ?? null;
    height = size?.height ?? null;
  }

  let type: EmbedType = 'link';
  if (photo) type = 'image';
  else if (player && provider.plays) type = provider.plays;

  return {
    ...emptyResult(url),
    title,
    description,
    image,
    images: image ? [image] : [],
    imageWidth: width,
    imageHeight: height,
    favicon: safeResolve('/favicon.ico', url),
    siteName: field(answer, 'provider_name') ?? provider.name,
    type,
    player: type === 'link' ? null : player,
    authorName: field(answer, 'author_name'),
    authorUrl: safeResolve(field(answer, 'author_url'), url),
  };
}

/** The oEmbed resolver; `endpointFor` is a seam for tests, which can only
 * reach a local server. */
export function createOembedResolver(endpointFor: (provider: Provider) => string = (p) => p.endpoint): Resolver {
  return {
    name: 'oembed',
    matches: (url) => providerFor(url) !== null,
    transform: (url) => providerFor(url)?.transform?.(url) ?? url,
    async resolve({ url, lookup }) {
      const provider = providerFor(new URL(url));
      if (!provider) return null;
      const endpoint = new URL(endpointFor(provider));
      endpoint.searchParams.set('url', url);
      for (const [key, value] of Object.entries(provider.params ?? {})) endpoint.searchParams.set(key, value);
      return previewFromOembed(url, provider, await fetchJson(endpoint.toString(), lookup), lookup);
    },
  };
}
