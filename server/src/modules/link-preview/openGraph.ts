import { allMeta, firstMeta, parsePageMeta } from './htmlMeta.js';
import { fetchPage, probeImageSize, probeMediaType, type Lookup } from './pageFetch.js';
import { emptyResult, hostnameOf, isAllowlistedPlayer, MAX_IMAGES, safeResolve, type EmbedType, type LinkPreviewResult, type Resolver } from './preview.js';

// The resolver every URL ends at: fetch it, and read a page's Open Graph and
// Twitter Card tags, or describe the file the URL turned out to be.

const IMAGE_KEYS = ['og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image', 'twitter:image:src'];

/** Resolved, deduplicated, at most MAX_IMAGES. A page often names the same
 * picture twice, over http and https (`og:image` and its `secure_url`): one
 * entry, the https one. */
export function collectImages(raw: string[], base: string): string[] {
  const byKey = new Map<string, string>();
  for (const value of raw) {
    const resolved = safeResolve(value, base);
    if (!resolved) continue;
    const key = resolved.replace(/^https?:/, '');
    const seen = byKey.get(key);
    if (!seen) byKey.set(key, resolved);
    else if (seen.startsWith('http:') && resolved.startsWith('https:')) byKey.set(key, resolved);
    if (byKey.size >= MAX_IMAGES) break;
  }
  return [...byKey.values()];
}

export interface ClassifyInput {
  twitterCard: string | null;
  ogType: string | null;
  /** an allowlisted player page was found */
  player: boolean;
  /** `og:video` answered with a video content type */
  video: boolean;
  /** `og:audio` answered with an audio content type */
  audio: boolean;
  image: boolean;
}

/** What kind of card a page makes. A page only plays when what it names
 * really plays: an allowlisted player, or a file whose type was checked. */
export function classifyEmbed(input: ClassifyInput): EmbedType {
  const card = input.twitterCard?.toLowerCase() ?? null;
  const ogType = input.ogType?.toLowerCase() ?? null;
  if (card === 'photo' && input.image) return 'image';
  if (input.player && (card === 'player' || ogType?.startsWith('video'))) return 'video';
  if (input.video) return 'video';
  if (input.audio) return 'audio';
  if (card === 'summary_large_image') return 'article';
  return 'link';
}

async function previewFromHtml(url: string, html: string, finalUrl: string, lookup?: Lookup): Promise<LinkPreviewResult> {
  const { metas, title: titleTag, favicon: iconHref } = parsePageMeta(html);
  const images = collectImages(allMeta(metas, ...IMAGE_KEYS), finalUrl);
  const twitterCard = firstMeta(metas, 'twitter:card');
  const ogType = firstMeta(metas, 'og:type');
  const twitterPlayer = safeResolve(firstMeta(metas, 'twitter:player'), finalUrl);
  const ogVideo = safeResolve(firstMeta(metas, 'og:video:secure_url', 'og:video:url', 'og:video'), finalUrl);
  const ogAudio = safeResolve(firstMeta(metas, 'og:audio:secure_url', 'og:audio:url', 'og:audio'), finalUrl);
  const player = [twitterPlayer, ogVideo].find((candidate) => isAllowlistedPlayer(candidate)) ?? null;

  // A page's `og:video` is often its own HTML player, which a <video> cannot
  // play: only a file that answers as video counts.
  const [size, videoType, audioType] = await Promise.all([
    images[0] ? probeImageSize(images[0], lookup) : null,
    ogVideo && ogVideo !== player ? probeMediaType(ogVideo, lookup) : null,
    ogAudio ? probeMediaType(ogAudio, lookup) : null,
  ]);
  const video = videoType?.startsWith('video/') ? ogVideo : null;
  const audio = audioType?.startsWith('audio/') ? ogAudio : null;
  const type = classifyEmbed({ twitterCard, ogType, player: !!player, video: !!video, audio: !!audio, image: images.length > 0 });

  return {
    url,
    title: firstMeta(metas, 'og:title', 'twitter:title') ?? titleTag ?? firstMeta(metas, 'title'),
    description: firstMeta(metas, 'og:description', 'description', 'twitter:description'),
    image: images[0] ?? null,
    video,
    favicon: safeResolve(iconHref, finalUrl) ?? safeResolve('/favicon.ico', finalUrl),
    siteName: firstMeta(metas, 'og:site_name', 'application-name') ?? hostnameOf(finalUrl),
    themeColor: firstMeta(metas, 'theme-color'),
    imageWidth: size?.width ?? null,
    imageHeight: size?.height ?? null,
    type,
    images,
    imageAlt: images.length ? firstMeta(metas, 'og:image:alt', 'twitter:image:alt') : null,
    audio,
    // a player the page is not about (a stray og:video on an article) is not one to offer
    player: type === 'video' ? player : null,
  };
}

export const openGraphResolver: Resolver = {
  name: 'open-graph',
  matches: () => true,
  async resolve({ url, lookup }) {
    const page = await fetchPage(url, lookup);
    switch (page.kind) {
      case 'html':
        return previewFromHtml(url, page.html, page.finalUrl, lookup);
      case 'image':
        // a bare picture link: no page to read, but the card can still reserve its size
        return { ...emptyResult(url), type: 'image', image: page.finalUrl, images: [page.finalUrl], imageWidth: page.size?.width ?? null, imageHeight: page.size?.height ?? null };
      case 'video':
        return { ...emptyResult(url), type: 'video', video: page.finalUrl };
      case 'audio':
        return { ...emptyResult(url), type: 'audio', audio: page.finalUrl };
      case 'other':
        return emptyResult(url);
    }
  },
};
