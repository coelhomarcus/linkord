export type NavigationDecision = 'allow' | 'external' | 'deny';

const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/**
 * Where a link or redirect may go. Only the app's own origin opens inside the
 * app; the page runs with the account's session, so anything else goes to the
 * system browser, and schemes the browser has no business opening are dropped.
 */
export function classifyNavigation(target: string, appOrigin: string): NavigationDecision {
  let url: URL;
  try { url = new URL(target); } catch { return 'deny'; }
  if (url.origin === appOrigin) return 'allow';
  return EXTERNAL_PROTOCOLS.has(url.protocol) ? 'external' : 'deny';
}
