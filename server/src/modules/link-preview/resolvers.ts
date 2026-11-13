import { logger } from '../../lib/logger.js';
import { createOembedResolver } from './oembed.js';
import { openGraphResolver } from './openGraph.js';
import { hasContent, type LinkPreviewResult, type ResolveContext, type Resolver } from './preview.js';

const log = logger.child({ component: 'link-preview' });

// Most specific first; Open Graph matches everything, so it is always last.
// A per-site resolver (X, Bluesky, Wikipedia) goes before it.
const DEFAULT_RESOLVERS: readonly Resolver[] = [createOembedResolver(), openGraphResolver];

/** Query parameters that only track where a click came from: the same page
 * with or without them is one preview. */
const TRACKING_PARAM_RE = /^(utm_.+|fbclid|gclid|dclid|msclkid|mc_eid|igshid)$/i;

/** The URL a preview is fetched and cached under: the matching resolver's
 * one form of it, without tracking parameters or a fragment. */
export function canonicalUrl(rawUrl: string, resolvers: readonly Resolver[] = DEFAULT_RESOLVERS): string {
  let url: URL;
  try { url = new URL(rawUrl); } catch { return rawUrl; }
  const resolver = resolvers.find((r) => r.transform && r.matches(url));
  if (resolver?.transform) url = resolver.transform(url);
  for (const key of [...url.searchParams.keys()]) if (TRACKING_PARAM_RE.test(key)) url.searchParams.delete(key);
  url.hash = '';
  return url.toString();
}

/** The first preview with content among the resolvers that match. A resolver
 * that throws or finds nothing hands over to the next one. The result is null
 * only when every one of them failed: a page that was read and simply has no
 * metadata is an empty preview, not a failure. Never throws. */
export async function runResolvers(ctx: ResolveContext, resolvers: readonly Resolver[] = DEFAULT_RESOLVERS): Promise<LinkPreviewResult | null> {
  let parsed: URL;
  try { parsed = new URL(ctx.url); } catch { return null; }
  let empty: LinkPreviewResult | null = null;
  for (const resolver of resolvers) {
    if (!resolver.matches(parsed)) continue;
    try {
      const result = await resolver.resolve(ctx);
      if (result && hasContent(result)) return result;
      empty ??= result;
    } catch (err) {
      log.debug('resolver failed', { resolver: resolver.name, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return empty;
}
