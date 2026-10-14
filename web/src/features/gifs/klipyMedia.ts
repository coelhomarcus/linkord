// KLIPY serves media from static.klipy.com and numbered mirrors (static1, static2…)
const KLIPY_MEDIA_RE = /^https:\/\/static\d*\.klipy\.com\/\S+$/i;

/** A URL that points at a KLIPY GIF file — what a GIF message carries as its text. */
export function isKlipyMediaUrl(url: string): boolean {
  return KLIPY_MEDIA_RE.test(url);
}

/** The KLIPY URL when the whole message is one GIF and nothing else. */
export function gifMessageUrl(text: string): string | null {
  const trimmed = text.trim();
  return isKlipyMediaUrl(trimmed) ? trimmed : null;
}
