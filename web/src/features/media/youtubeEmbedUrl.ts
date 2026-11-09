/** Seconds from a YouTube link's `t`/`start` (`90`, `90s`, `1m30s`, `1h2m3s`), or null. */
export function youtubeStartSeconds(url: string): number | null {
  let raw: string | null;
  try {
    const params = new URL(url).searchParams;
    raw = params.get('t') ?? params.get('start');
  } catch {
    return null;
  }
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return Number(raw) || null;
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(raw);
  if (!match || !match[0]) return null;
  const seconds = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
  return seconds || null;
}

/** The player opened by a click, so it starts playing at once. A plain iframe:
 * YouTube's script API would have to run inside our page, which the
 * Content-Security-Policy does not allow. */
export function youtubeEmbedUrl(videoId: string, linkUrl: string): string {
  const params = new URLSearchParams({ autoplay: '1', playsinline: '1', rel: '0', iv_load_policy: '3' });
  const start = youtubeStartSeconds(linkUrl);
  if (start) params.set('start', String(start));
  return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?${params}`;
}
