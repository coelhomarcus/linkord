import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../../config/env.js';
import { sendJson, sendError, jsonBody } from '../../http/respond.js';
import { parseCookies } from '../../http/cookies.js';
import { resolveSession } from '../auth/session.js';
import { countAppBadge, countUnread, deleteAllNotifications, deleteNotification, getPushShowContent, listNotifications, markRead, setPushShowContent } from './notificationsRepository.js';
import { pushAvailable, validPushSubscription, savePushSubscription, removePushSubscription } from './webPush.js';
import { listNotificationSettings, updateNotificationSetting, type NotificationScope } from './notificationSettings.js';
import { isMuteDuration, isNotificationLevel, type NotificationSettingChange } from './notificationSettingsPolicy.js';

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

  fastify.get('/api/notifications/push/preferences', async (request, reply) => {
    const sess = await session(request, reply);
    if (sess) sendJson(reply, 200, { showContent: await getPushShowContent(sess.userId) });
  });

  fastify.patch('/api/notifications/push/preferences', async (request, reply) => {
    const sess = await session(request, reply);
    if (!sess) return;
    const { showContent } = jsonBody(request.body);
    if (typeof showContent !== 'boolean') return sendError(reply, 400, 'invalid_request', 'Informe showContent como verdadeiro ou falso.');
    await setPushShowContent(sess.userId, showContent);
    sendJson(reply, 200, { showContent });
  });

  fastify.get('/api/notification-settings', async (request, reply) => {
    const sess = await session(request, reply);
    if (sess) sendJson(reply, 200, await listNotificationSettings(sess.userId));
  });

  // `level`: a level, or null to inherit. `mute`: minutes from MUTE_DURATIONS_MINUTES, 'forever', or false to unmute.
  // The server works out when a mute ends, so a tab with a wrong clock cannot mute for longer than asked.
  fastify.patch('/api/notification-settings/:scope/:id', async (request: FastifyRequest<{ Params: { scope: string; id: string } }>, reply) => {
    const sess = await session(request, reply);
    if (!sess) return;
    const scope: NotificationScope | null = request.params.scope === 'servers' ? 'server' : request.params.scope === 'conversations' ? 'conversation' : null;
    if (!scope) return sendError(reply, 404, 'not_found', 'Não encontrado.');
    const body = jsonBody(request.body);
    const change: NotificationSettingChange = {};
    if ('level' in body) {
      if (body.level !== null && !isNotificationLevel(body.level)) return sendError(reply, 400, 'invalid_request', 'Nível de notificação inválido.');
      change.level = body.level;
    }
    if ('mute' in body) {
      if (body.mute !== false && !isMuteDuration(body.mute)) return sendError(reply, 400, 'invalid_request', 'Duração inválida.');
      change.mute = body.mute;
    }
    if (change.level === undefined && change.mute === undefined) return sendError(reply, 400, 'invalid_request', 'Informe level ou mute.');
    const setting = await updateNotificationSetting(sess.userId, scope, String(request.params.id || ''), change);
    if (setting === 'not_found') return sendError(reply, 404, 'not_found', 'Não encontrado.');
    sendJson(reply, 200, { setting });
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

  fastify.get('/api/notifications/badge', async (request, reply) => {
    const sess = await session(request, reply);
    if (sess) sendJson(reply, 200, { count: await countAppBadge(sess.userId) });
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
