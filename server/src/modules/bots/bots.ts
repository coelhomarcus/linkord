import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../../config/env.js';
import { db } from '../../db/client.js';
import { sendJson, sendError, jsonBody } from '../../http/respond.js';
import { parseCookies } from '../../http/cookies.js';
import { resolveSession } from '../auth/session.js';
import * as floodControl from '../../realtime/floodControl.js';
import { sendToUser } from '../presence/participants.js';
import { botCreationBlocked } from '../limits/limits.js';
import { canManageGroup, createGroup, getConversationForUser, rowToSummary, sanitizeConversationTitle } from '../conversations/conversationsRepository.js';
import { createInvitations, normalizeInviteeIds, type InviteResult } from '../conversations/invitationsRepository.js';
import { createWebhook, getBotWebhook, rotateBotWebhookToken, toWebhookInfo } from './webhooksRepository.js';
import { logger } from '../../lib/logger.js';

const log = logger.child({ component: 'bots' });

// HTTP surface for a bot's own lifecycle: creating one and handling its
// webhook credential. Everything a bot shares with a group (renaming,
// inviting, leaving, deleting) goes through the group endpoints and socket
// events, which accept both.

type BotParams = { conversationId: string };

async function requireSession(request: FastifyRequest, reply: FastifyReply): Promise<{ userId: string } | null> {
  const cookies = parseCookies(request.headers.cookie || '');
  const sess = await resolveSession(cookies[config.SESSION_COOKIE]);
  if (!sess) {
    sendError(reply, 401, 'unauthenticated', 'Não autenticado.');
    return null;
  }
  return sess;
}

/** Only the bot's owner ever sees anything about its webhook — members just
 * read what it posts. A non-owner gets the same answer as a missing bot. */
async function isBotOwner(conversationId: string, userId: string): Promise<boolean> {
  const conversation = await getConversationForUser(conversationId, userId);
  return conversation?.type === 'bot' && await canManageGroup(conversationId, userId);
}

/** The bot and its webhook are created together, so a bot never exists
 * without a way to post into it. The token travels only in this answer. */
async function handleCreateBot(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const sess = await requireSession(request, reply);
  if (!sess) return;
  if (!floodControl.allow(`bot-create:${sess.userId}`, { windowMs: 60_000, max: 10 })) {
    return sendError(reply, 429, 'rate_limited', 'Você está criando bots rápido demais. Espere um pouco.');
  }
  const body = jsonBody(request.body);
  const title = sanitizeConversationTitle(body.title);
  if (!title) return sendError(reply, 400, 'invalid_title', 'Dê um nome ao bot.');
  const { ids, tooMany } = normalizeInviteeIds(body.inviteeIds, sess.userId);
  if (tooMany) return sendError(reply, 400, 'too_many_invitees', `Convide até ${config.MAX_INVITEES_PER_REQUEST} pessoas por vez.`);
  if (await botCreationBlocked(sess.userId)) {
    return sendError(reply, 409, 'quota_exceeded', 'Você atingiu o limite de bots. Apague algum antes de criar outro.');
  }

  const { conversation, webhook } = await db.transaction(async (tx) => {
    const created = await createGroup(sess.userId, title, 'bot', tx);
    return { conversation: created, webhook: await createWebhook(tx, created.id, sess.userId) };
  });
  sendToUser(sess.userId, { t: 'conversation-opened', conversationId: conversation.id, conversation: rowToSummary(conversation, [sess.userId], null, 'owner', sess.userId) });
  let results: InviteResult[] = [];
  if (ids.length) {
    const invited = await createInvitations(sess.userId, conversation.id, ids);
    if ('results' in invited) results = invited.results;
  }
  log.info('bot created', { conversationId: conversation.id, ownerId: sess.userId });
  sendJson(reply, 201, { conversationId: conversation.id, webhook, results });
}

async function handleGetWebhook(request: FastifyRequest<{ Params: BotParams }>, reply: FastifyReply): Promise<void> {
  const sess = await requireSession(request, reply);
  if (!sess) return;
  const conversationId = String(request.params.conversationId || '');
  const webhook = await isBotOwner(conversationId, sess.userId) ? await getBotWebhook(conversationId) : null;
  if (!webhook) return sendError(reply, 404, 'not_found', 'Bot não encontrado.');
  sendJson(reply, 200, { webhook: toWebhookInfo(webhook) });
}

/** A leaked URL is fixed by rotating: the old token dies at once. Also the
 * only way to see a token again, since only its hash is kept. */
async function handleRotateToken(request: FastifyRequest<{ Params: BotParams }>, reply: FastifyReply): Promise<void> {
  const sess = await requireSession(request, reply);
  if (!sess) return;
  if (!floodControl.allow(`bot-rotate:${sess.userId}`, { windowMs: 60_000, max: 10 })) {
    return sendError(reply, 429, 'rate_limited', 'Muitas trocas de token em pouco tempo. Espere um pouco.');
  }
  const conversationId = String(request.params.conversationId || '');
  const webhook = await isBotOwner(conversationId, sess.userId) ? await rotateBotWebhookToken(conversationId) : null;
  if (!webhook) return sendError(reply, 404, 'not_found', 'Bot não encontrado.');
  log.info('bot webhook token rotated', { conversationId, webhookId: webhook.id });
  sendJson(reply, 200, { webhook });
}

export function registerBotRoutes(fastify: FastifyInstance): void {
  fastify.post('/api/bots', handleCreateBot);
  fastify.get('/api/bots/:conversationId/webhook', handleGetWebhook);
  fastify.post('/api/bots/:conversationId/webhook/rotate', handleRotateToken);
}
