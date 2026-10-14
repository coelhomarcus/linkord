import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../../config/env.js';
import { parseCookies } from '../../http/cookies.js';
import { sendError, sendJson } from '../../http/respond.js';
import { resolveSession } from '../auth/session.js';

/** KLIPY keys "recent GIFs" and its analytics by a customer id that must stay
 * the same for a user. A hash of the account id gives them that without
 * handing a third party our real ids. */
export function klipyCustomerId(userId: string): string {
  return createHash('sha256').update(`klipy:${userId}`).digest('hex').slice(0, 32);
}

export type GifConfig = { enabled: false } | { enabled: true; apiKey: string; customerId: string };

export function gifConfigFor(userId: string, apiKey: string = config.KLIPY_API_KEY): GifConfig {
  if (!apiKey) return { enabled: false };
  return { enabled: true, apiKey, customerId: klipyCustomerId(userId) };
}

// KLIPY's terms require their API to be called from the user's own client, not
// through our servers, so this hands the key to signed-in users only (it stays
// out of the bundle and the repo) instead of proxying the requests.
async function handleGifConfig(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const cookies = parseCookies(request.headers.cookie || '');
  const sess = await resolveSession(cookies[config.SESSION_COOKIE]);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');
  reply.header('Cache-Control', 'no-store');
  sendJson(reply, 200, gifConfigFor(sess.userId));
}

export function registerGifRoutes(fastify: FastifyInstance): void {
  fastify.get('/api/gifs/config', handleGifConfig);
}
