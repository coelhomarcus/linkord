import { thumbHashToDataURL } from 'thumbhash';

// A conversation's worth of pictures is a few hundred small decodes; kept so
// scrolling back over a row paints at once. Insertion order doubles as LRU.
const MAX_ENTRIES = 500;
const cache = new Map<string, string | null>();

// a ThumbHash is at least 5 bytes (header and average colour)
const MIN_BYTES = 5;

/** The blurred stand-in for a picture (the server's base64 ThumbHash) as an
 * image the box can paint behind the real one. Null when there is none or it
 * can't be read: the box then just stays plain. */
export function placeholderDataUrl(placeholder: string | undefined): string | null {
  if (!placeholder) return null;
  const known = cache.get(placeholder);
  if (known !== undefined) return known;
  let url: string | null = null;
  try {
    const bytes = Uint8Array.from(atob(placeholder), (char) => char.charCodeAt(0));
    if (bytes.length >= MIN_BYTES) url = thumbHashToDataURL(bytes);
  } catch { /* not base64, or not a ThumbHash */ }
  cache.set(placeholder, url);
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  return url;
}
