import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { RateLimitUnavailableError } from '../modules/auth/ratelimit.js';
import { logger } from '../lib/logger.js';
import { sendError, sendJson } from './respond.js';
import { errorBody } from './errors.js';
import { loggablePath } from './requestPath.js';

const log = logger.child({ component: 'http' });

/** Any error a route throws ends here as JSON (Fastify already catches sync
 * throws and rejected promises, so routes need no try/catch).
 *
 * A 4xx is thrown on purpose (`jsonBody`'s `invalid_json`) or comes from
 * Fastify's own body handling (FST_ERR_*): its code and message are meant for
 * the client and go out as they are. Anything 5xx is unexpected, and its
 * message is internal: Drizzle's carries the failed SQL and its parameters, a
 * library's or the filesystem's names paths. The client gets a generic body
 * with the request id instead; the full error stays in the log under the same
 * `reqId`. */
export function handleRouteError(err: FastifyError, request: FastifyRequest, reply: FastifyReply): void {
  // fail closed: without the counters a brute-force limit cannot be enforced, so the attempt is refused (already logged where it failed)
  if (err instanceof RateLimitUnavailableError) {
    reply.header('Retry-After', '30');
    return sendError(reply, 503, 'rate_limit_unavailable', 'Não foi possível verificar suas tentativas agora. Tente novamente em instantes.');
  }
  const status = err.statusCode ?? 500;
  if (status >= 500) {
    log.error('error in a route', err, { reqId: request.id, method: request.method, url: loggablePath(request) });
    return sendJson(reply, 500, errorBody('internal_error', 'Erro interno.', { requestId: request.id }));
  }
  // the one place allowed to put a code outside the registry on the wire: Fastify's FST_ERR_* codes
  sendJson(reply, status, { error: { code: err.code || 'invalid_request', message: err.message || 'Requisição inválida.' } });
}
