// Mirrors server/src/modules/link-preview/playerHosts.ts, pinned by a server
// test: the server only stores a preview's `player` on these hosts, and the
// Content-Security-Policy frames exactly them. Checked again here because a
// frame the policy refuses would be a broken box in the card.
const PLAYER_HOSTS = ['youtube.com', 'youtube-nocookie.com', 'youtu.be', 'vimeo.com', 'soundcloud.com', 'twitch.tv', 'streamable.com', 'x.com', 'twitter.com'] as const;

const onHost = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

/** The iframe address for a preview's `player`, set to start at once (it is
 * only loaded by a click), or null when it is not on an allowlisted host.
 * `pageHost` is this page's hostname, which Twitch requires as `parent`. */
export function linkPlayerUrl(raw: string | null | undefined, pageHost: string): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || !PLAYER_HOSTS.some((domain) => onHost(host, domain))) return null;
  const params = url.searchParams;
  if (onHost(host, 'soundcloud.com')) {
    params.set('auto_play', 'true');
    // the compact player, which fits the fixed height an audio card gives it
    params.set('visual', 'false');
  } else if (onHost(host, 'twitch.tv')) {
    params.set('parent', pageHost);
    params.set('autoplay', 'true');
  } else {
    // YouTube, Vimeo and Streamable read the same parameter
    params.set('autoplay', '1');
  }
  return url.toString();
}
