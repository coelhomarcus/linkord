/** A secure page cannot display an HTTP media resource, even when its
 * metadata came from a trusted server-side link preview. */
export function canLoadMediaUrl(url: string, pageProtocol = window.location.protocol): boolean {
  try {
    const base = new URL(window.location.href);
    base.protocol = pageProtocol;
    const protocol = new URL(url, base).protocol;
    return !(pageProtocol === 'https:' && protocol === 'http:');
  } catch {
    return false;
  }
}
