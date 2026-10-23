import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sendJson, sendError } from '../../http/respond.js';
import { sessionTokenFromHeaders } from '../../http/cookies.js';
import { resolveSession } from '../auth/session.js';
import { getUserLimits } from './limits.js';

async function handleMyLimits(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const sess = await resolveSession(sessionTokenFromHeaders(request.headers));
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');
  sendJson(reply, 200, { limits: await getUserLimits(sess.userId) });
}

export function registerLimitsRoutes(fastify: FastifyInstance): void {
  fastify.get('/api/me/limits', handleMyLimits);
}
