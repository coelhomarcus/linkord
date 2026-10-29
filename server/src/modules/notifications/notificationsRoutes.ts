import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../../config/env.js';
import { sendJson, sendError, jsonBody } from '../../http/respond.js';
import { parseCookies } from '../../http/cookies.js';
import { resolveSession } from '../auth/session.js';
import { countUnread, deleteAllNotifications, deleteNotification, listNotifications, markRead } from './notificationsRepository.js';
import { pushAvailable, validPushSubscription, savePushSubscription, removePushSubscription } from './webPush.js';

async function session(request: FastifyRequest, reply: FastifyReply): Promise<{ userId: string } | null> {
  const cookies = parseCookies(request.headers.cookie || '');
  const sess = await resolveSession(cookies[config.SESSION_COOKIE]);
  if (!sess) sendError(reply, 401, 'unauthenticated', 'Não autenticado.');
  return sess;
}

export function registerNotificationRoutes(fastify: FastifyInstance): void {
  fastify.get('/api/notifications/push/config', async (_request, reply) => {
    sendJson(reply, 200, { available: pushAvailable, publicKey: pushAvailable ? config.PUSH_VAPID_PUBLIC_KEY : null });
  });

  fastify.post('/api/notifications/push', async (request, reply) => {
    const sess = await session(request, reply);
    if (!sess) return;
    if (!pushAvailable) return sendError(reply, 503, 'push_unavailable', 'Notificações push não configuradas.');
    if (!validPushSubscription(request.body)) return sendError(reply, 400, 'invalid_request', 'Assinatura push inválida.');
    await savePushSubscription(sess.userId, request.body);
    sendJson(reply, 200, { ok: true });
  });

  fastify.delete('/api/notifications/push', async (request, reply) => {
    const sess = await session(request, reply);
    if (!sess) return;
    const body = jsonBody(request.body);
    if (typeof body.endpoint !== 'string' || body.endpoint.length > 2048) return sendError(reply, 400, 'invalid_request', 'Assinatura push inválida.');
    await removePushSubscription(sess.userId, body.endpoint);
    sendJson(reply, 200, { ok: true });
  });

  fastify.get('/api/notifications', async (request: FastifyRequest<{ Querystring: { cursor?: string } }>, reply) => {
    const sess = await session(request, reply);
    if (!sess) return;
    const page = await listNotifications(sess.userId, request.query.cursor);
    if (page === 'invalid_cursor') return sendError(reply, 400, 'invalid_cursor', 'Cursor inválido.');
    sendJson(reply, 200, page);
  });

  fastify.get('/api/notifications/summary', async (request, reply) => {
    const sess = await session(request, reply);
    if (sess) sendJson(reply, 200, { unread: await countUnread(sess.userId) });
  });

  fastify.post('/api/notifications/read', async (request, reply) => {
    const sess = await session(request, reply);
    if (!sess) return;
    const body = jsonBody(request.body);
    const ids = body.all === true ? 'all' as const : Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === 'string').slice(0, 100) : null;
    if (ids === null) return sendError(reply, 400, 'invalid_request', 'Informe ids ou all.');
    sendJson(reply, 200, { marked: await markRead(sess.userId, ids) });
  });

  fastify.delete('/api/notifications', async (request, reply) => {
    const sess = await session(request, reply);
    if (sess) sendJson(reply, 200, { deleted: await deleteAllNotifications(sess.userId) });
  });

  fastify.delete('/api/notifications/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const sess = await session(request, reply);
    if (sess) sendJson(reply, 200, { deleted: await deleteNotification(sess.userId, String(request.params.id || '')) });
  });
}
