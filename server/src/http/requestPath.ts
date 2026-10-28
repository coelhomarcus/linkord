import type { FastifyRequest } from 'fastify';

// A webhook's token travels in its URL, so a raw path in a log line is a
// credential in the log. The matched route's pattern
// ('/api/webhooks/:webhookId/:token') is safe; only a request that matched no
// route falls back to the real path, and that gets the token cut out.

const WEBHOOK_TOKEN_IN_PATH = /^(\/api\/webhooks\/[^/]+)\/.+$/;

/** The request's path as it may appear in a log: no query string, no secret. */
export function loggablePath(request: FastifyRequest): string {
  const route = request.routeOptions?.url;
  if (route) return route;
  return request.url.split('?')[0]!.replace(WEBHOOK_TOKEN_IN_PATH, '$1/[redacted]');
}
