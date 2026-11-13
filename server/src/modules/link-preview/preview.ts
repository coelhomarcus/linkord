import type { Lookup } from './pageFetch.js';

// The shape of a link preview and of a resolver, shared by the resolvers and
// linkPreview.ts. Kept apart so a resolver can build a preview without
// depending on linkPreview.ts, which depends on the resolvers.

/** What the card is about, for the client to pick its layout. `video` and
 * `audio` mean something plays: a file whose type was checked (`video`,
 * `audio`) or an allowlisted player page (`player`). */
export type EmbedType = 'link' | 'article' | 'image' | 'video' | 'audio';

export interface LinkPreviewResult {
  url: string;
  title: string | null;
  description: string | null;
  /** The first of `images`, kept for tabs and stored rows from before `images`. */
  image: string | null;
  /** A direct video file (its content type was checked), never a page. */
  video: string | null;
  favicon: string | null;
  siteName: string;
  themeColor: string | null;
  /** Pixel size of `image` (as displayed), so the client can reserve the
   * box before it loads; null when it could not be read. */
  imageWidth: number | null;
  imageHeight: number | null;
  // Everything below came later and is optional: messages stored before it
  // lack these fields, and a tab from before ignores them.
  type?: EmbedType;
  /** Every picture the page names, deduplicated, at most MAX_IMAGES. */
  images?: string[];
  imageAlt?: string | null;
  /** A direct audio file (its content type was checked). */
  audio?: string | null;
  /** A player page on an allowlisted host, meant for an iframe. */
  player?: string | null;
  authorName?: string | null;
  authorUrl?: string | null;
}

export const MAX_IMAGES = 10;

export interface ResolveContext {
  /** The canonical URL (see canonicalUrl in resolvers.ts), the one fetched. */
  url: string;
  lookup?: Lookup;
}

/** One way of turning a URL into a preview. Resolvers are tried in order;
 * `null` or a throw hands the URL to the next one. */
export interface Resolver {
  name: string;
  matches(url: URL): boolean;
  /** The one form of a URL that has many (a YouTube video's). */
  transform?(url: URL): URL;
  resolve(ctx: ResolveContext): Promise<LinkPreviewResult | null>;
}

export function hostnameOf(rawUrl: string): string {
  try { return new URL(rawUrl).hostname.replace(/^www\./, ''); } catch { return rawUrl; }
}

export function emptyResult(rawUrl: string): LinkPreviewResult {
  return { url: rawUrl, title: null, description: null, image: null, video: null, favicon: null, siteName: hostnameOf(rawUrl), themeColor: null, imageWidth: null, imageHeight: null };
}

/** Whether a preview has anything beyond the domain-only card. */
export function hasContent(preview: LinkPreviewResult): boolean {
  return !!(preview.title || preview.description || preview.image || preview.video || preview.audio || preview.player);
}

export function safeResolve(raw: string | null | undefined, base: string): string | null {
  if (!raw) return null;
  try {
    const resolved = new URL(raw.trim(), base);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return null;
    return resolved.toString();
  } catch {
    return null;
  }
}

/** Hosts whose player pages may become an iframe. Anything else that calls
 * itself a player is just a link. */
const PLAYER_HOSTS = ['youtube.com', 'youtube-nocookie.com', 'youtu.be', 'vimeo.com', 'soundcloud.com', 'twitch.tv', 'streamable.com', 'x.com', 'twitter.com'];

export function hostMatches(host: string, domains: readonly string[]): boolean {
  const h = host.toLowerCase();
  return domains.some((domain) => h === domain || h.endsWith(`.${domain}`));
}

export function isAllowlistedPlayer(rawUrl: string | null | undefined): boolean {
  if (!rawUrl) return false;
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'https:' && hostMatches(url.hostname, PLAYER_HOSTS);
  } catch {
    return false;
  }
}
