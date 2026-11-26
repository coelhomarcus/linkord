import type { FastifyInstance } from 'fastify';

// The web app lived under /app until it moved to the root of its origin.
// Emails already sent, push notifications, bookmarks, installed PWAs (their
// start URL and shortcuts) and older desktop apps still open /app URLs, so
// those answer with a permanent redirect to the same page at the root. The
// browser keeps the URL's #fragment across the redirect on its own.

const LEGACY_PREFIX = /^\/app(?=[/?]|$)/;

/** Where a legacy /app URL (path and query) now lives, or null for any other URL. */
export function legacyAppRedirect(url: string): string | null {
  if (!LEGACY_PREFIX.test(url)) return null;
  // '/app//host' or '/app/\host' must not become a protocol-relative URL to another host
  return `/${url.replace(LEGACY_PREFIX, '').replace(/^[/\\]+/, '')}`;
}

export function registerLegacyAppRedirect(fastify: FastifyInstance): void {
  const redirect = (url: string) => legacyAppRedirect(url) ?? '/';
  // GET and HEAD only: the app never posted to /app, and an API call never lived there
  fastify.get('/app', (request, reply) => reply.redirect(redirect(request.url), 301));
  fastify.get('/app/*', (request, reply) => reply.redirect(redirect(request.url), 301));
}
