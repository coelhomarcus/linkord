import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../../config/env.js';
import { sendJson, sendError, jsonBody } from '../../http/respond.js';
import * as floodControl from '../../realtime/floodControl.js';
import { normalizeSearchQuery } from '../friendships/cursor.js';
import {
  acceptInvitation, createInvitations, declineInvitation, listReceivedInvitations, listServerInvitations,
  revokeInvitation, type InvitationAction,
} from './serverInvitationsRepository.js';
import { requireSession } from './serverHttp.js';
import { logger } from '../../lib/logger.js';

const log = logger.child({ component: 'invitations' });

// HTTP surface of friend invitations to a server (docs/plano-rede-social.md
// §8.2): commands answer with an explicit, per-recipient result, lists are
// cursor-paginated with a server-fixed page size.

type IdParams = { id: string };
type ServerParams = { serverId: string };

function respondAction(reply: FastifyReply, result: InvitationAction): void {
  switch (result.code) {
    case 'ok': log.info('invitation updated', { invitationId: result.card.id, status: result.card.status, serverId: result.card.serverId }); return sendJson(reply, 200, { invitation: result.card });
    case 'not_found': return sendError(reply, 404, 'not_found', 'Convite não encontrado.');
    case 'forbidden': return sendError(reply, 403, 'forbidden', 'Você não pode fazer isso.');
    case 'invalid_state': return sendError(reply, 409, 'conflict', 'Esse convite não está mais nesse estado.');
    case 'server_full': log.info('invitation accept blocked: server is full'); return sendError(reply, 409, 'server_full', 'O servidor já está cheio.');
    case 'banned': return sendError(reply, 403, 'banned', 'Você foi banido desse servidor.');
    case 'quota_exceeded': log.info('invitation accept blocked by the server quota'); return sendError(reply, 409, 'quota_exceeded', 'Você já participa do máximo de servidores permitido.');
  }
}

function respondInviteError(reply: FastifyReply, error: 'not_found' | 'forbidden' | 'too_many'): void {
  if (error === 'not_found') return sendError(reply, 404, 'not_found', 'Servidor não encontrado.');
  if (error === 'forbidden') return sendError(reply, 403, 'forbidden', 'Você não tem permissão para convidar pessoas para esse servidor.');
  return sendError(reply, 400, 'too_many_invitees', `Convide até ${config.MAX_INVITEES_PER_REQUEST} pessoas por vez.`);
}

async function handleInvite(request: FastifyRequest<{ Params: ServerParams }>, reply: FastifyReply): Promise<void> {
  const sess = await requireSession(request, reply);
  if (!sess) return;
  if (!floodControl.allow(`server-invite:${sess.userId}`, { windowMs: 60_000, max: 20 })) {
    return sendError(reply, 429, 'rate_limited', 'Você está enviando convites rápido demais. Espere um pouco.');
  }
  const body = jsonBody(request.body);
  const result = await createInvitations(sess.userId, String(request.params.serverId || ''), body.userIds);
  if ('error' in result) return respondInviteError(reply, result.error);
  sendJson(reply, 200, { results: result.results });
}

async function handleListSent(request: FastifyRequest<{ Params: ServerParams; Querystring: { cursor?: string } }>, reply: FastifyReply): Promise<void> {
  const sess = await requireSession(request, reply);
  if (!sess) return;
  const page = await listServerInvitations(sess.userId, String(request.params.serverId || ''), request.query.cursor);
  if (page === 'forbidden') return sendError(reply, 403, 'forbidden', 'Você não tem permissão para gerenciar esse servidor.');
  if (page === 'invalid_cursor') return sendError(reply, 400, 'invalid_cursor', 'Cursor inválido.');
  sendJson(reply, 200, page);
}

async function handleListReceived(request: FastifyRequest<{ Querystring: { cursor?: string; q?: string } }>, reply: FastifyReply): Promise<void> {
  const sess = await requireSession(request, reply);
  if (!sess) return;
  const page = await listReceivedInvitations(sess.userId, request.query.cursor, normalizeSearchQuery(request.query.q) || undefined);
  if (page === 'invalid_cursor') return sendError(reply, 400, 'invalid_cursor', 'Cursor inválido.');
  sendJson(reply, 200, page);
}

async function handleAccept(request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply): Promise<void> {
  const sess = await requireSession(request, reply);
  if (!sess) return;
  respondAction(reply, await acceptInvitation(sess.userId, String(request.params.id || '')));
}

async function handleDecline(request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply): Promise<void> {
  const sess = await requireSession(request, reply);
  if (!sess) return;
  respondAction(reply, await declineInvitation(sess.userId, String(request.params.id || '')));
}

async function handleRevoke(request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply): Promise<void> {
  const sess = await requireSession(request, reply);
  if (!sess) return;
  respondAction(reply, await revokeInvitation(sess.userId, String(request.params.id || '')));
}

export function registerServerInvitationRoutes(fastify: FastifyInstance): void {
  fastify.post('/api/servers/:serverId/invitations', handleInvite);
  fastify.get('/api/servers/:serverId/invitations', handleListSent);
  fastify.get('/api/server-invitations', handleListReceived);
  fastify.post('/api/server-invitations/:id/accept', handleAccept);
  fastify.post('/api/server-invitations/:id/decline', handleDecline);
  fastify.delete('/api/server-invitations/:id', handleRevoke);
}
