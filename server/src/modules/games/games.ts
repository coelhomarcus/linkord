import type { FastifyInstance, FastifyRequest } from 'fastify';
import { config } from '../../config/env.js';
import { parseCookies } from '../../http/cookies.js';
import { sendError, sendJson } from '../../http/respond.js';
import { createIgdbClient } from '../../integrations/igdb/igdb.js';
import { logger } from '../../lib/logger.js';
import { resolveSession } from '../auth/session.js';
import { createGameSearch, GameSearchError } from './gameSearch.js';
import { postponeIgdb, reserveIgdbSlot } from './igdbLimiter.js';

const log = logger.child({ component: 'games' });
const search = createGameSearch({
  client: createIgdbClient({ clientId: config.IGDB_CLIENT_ID, clientSecret: config.IGDB_CLIENT_SECRET }),
  reserve: () => reserveIgdbSlot(),
  postpone: postponeIgdb,
});
const MESSAGES = {
  invalid_request: 'Busca inválida.',
  rate_limited: 'Muitas buscas. Tente novamente em instantes.',
  games_unavailable: 'A busca de jogos está indisponível.',
  games_search_failed: 'Não foi possível buscar jogos agora.',
} as const;

export function registerGameRoutes(app: FastifyInstance): void {
  // The key stays on the server: the browser only ever talks to this route, never to IGDB.
  app.get('/api/games/search', async (request: FastifyRequest<{ Querystring: { q?: string } }>, reply) => {
    const me = await resolveSession(parseCookies(request.headers.cookie || '')[config.SESSION_COOKIE]);
    if (!me) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');
    try {
      sendJson(reply, 200, { games: await search(me.userId, request.query.q) });
    } catch (error) {
      if (!(error instanceof GameSearchError)) throw error;
      if (error.status === 502) log.warn('game search failed', { userId: me.userId });
      if (error.status === 429) reply.header('Retry-After', String(Math.max(1, Math.ceil(error.retryAfterMs / 1000))));
      sendError(reply, error.status, error.code, MESSAGES[error.code]);
    }
  });
}
