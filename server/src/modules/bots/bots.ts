import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, asc, count, eq } from 'drizzle-orm';
import { config } from '../../config/env.js';
import { db } from '../../db/client.js';
import { conversations, webhooks } from '../../db/schema.js';
import { sendJson, sendError, jsonBody } from '../../http/respond.js';
import * as floodControl from '../../realtime/floodControl.js';
import { isUploadedImage, sanitizeAvatar } from '../profile/sanitize.js';
import { deleteAvatarFile, isOwnedProfileImage } from '../attachments/attachmentCleanup.js';
import { hasPermission, PERMISSIONS } from '../servers/permissions.js';
import { channelPermissionsIn, loadServerSnapshot } from '../servers/serverAccess.js';
import { requireSession } from '../servers/serverHttp.js';
import { createWebhook, rotateWebhookToken, toWebhookInfo, type WebhookSecret } from './webhooksRepository.js';
import { logger } from '../../lib/logger.js';

const log = logger.child({ component: 'bots' });

// A channel's webhooks (Discord's "Integrations"): each one is a URL an
// outside system posts through, shown under its own name and picture. Only
// members with MANAGE_WEBHOOKS in the channel see or touch them; whoever
// else reads the channel just sees what they post.

type ChannelParams = { channelId: string };
type WebhookParams = { channelId: string; webhookId: string };

/** The URL the owner pastes into the sending system — the token in its path. */
function withUrl(secret: WebhookSecret): WebhookSecret & { url: string } {
  return { ...secret, url: `${config.APP_URL.replace(/\/+$/, '')}/api/webhooks/${secret.id}/${secret.token}` };
}

function sanitizeWebhookName(value: unknown): string | null {
  const s = String(value == null ? '' : value).replace(/[\r\n\t]+/g, ' ').trim().slice(0, 80);
  return s || null;
}

/** The caller holding MANAGE_WEBHOOKS in a text channel. Anyone else — a
 * non-member included — gets the same answer as a missing channel. */
async function requireWebhookManager(request: FastifyRequest, reply: FastifyReply, channelId: string): Promise<{ userId: string } | null> {
  const sess = await requireSession(request, reply);
  if (!sess) return null;
  const [channel] = await db.select({ serverId: conversations.serverId, type: conversations.type }).from(conversations).where(eq(conversations.id, channelId)).limit(1);
  const snapshot = channel?.serverId && channel.type === 'text' ? await loadServerSnapshot(channel.serverId) : null;
  if (!snapshot || !hasPermission(channelPermissionsIn(snapshot, channelId, sess.userId), PERMISSIONS.MANAGE_WEBHOOKS)) {
    sendError(reply, 404, 'not_found', 'Canal não encontrado.');
    return null;
  }
  return sess;
}

async function findChannelWebhook(channelId: string, webhookId: string) {
  const [row] = await db.select().from(webhooks).where(and(eq(webhooks.id, webhookId), eq(webhooks.conversationId, channelId))).limit(1);
  return row ?? null;
}

async function handleList(request: FastifyRequest<{ Params: ChannelParams }>, reply: FastifyReply): Promise<void> {
  const channelId = String(request.params.channelId || '');
  if (!(await requireWebhookManager(request, reply, channelId))) return;
  const rows = await db.select().from(webhooks).where(eq(webhooks.conversationId, channelId)).orderBy(asc(webhooks.createdAt));
  sendJson(reply, 200, { webhooks: rows.map(toWebhookInfo) });
}

/** The token travels only in this answer (and in a rotation's). */
async function handleCreate(request: FastifyRequest<{ Params: ChannelParams }>, reply: FastifyReply): Promise<void> {
  const channelId = String(request.params.channelId || '');
  const sess = await requireWebhookManager(request, reply, channelId);
  if (!sess) return;
  if (!floodControl.allow(`webhook-create:${sess.userId}`, { windowMs: 60_000, max: 10 })) {
    return sendError(reply, 429, 'rate_limited', 'Você está criando webhooks rápido demais. Espere um pouco.');
  }
  const name = sanitizeWebhookName(jsonBody(request.body).name);
  if (!name) return sendError(reply, 400, 'invalid_name', 'Dê um nome ao webhook.');
  const [{ value: existing } = { value: 0 }] = await db.select({ value: count() }).from(webhooks).where(eq(webhooks.conversationId, channelId));
  if (existing >= config.MAX_WEBHOOKS_PER_CHANNEL) return sendError(reply, 409, 'quota_exceeded', 'O canal já tem o máximo de webhooks.');
  const secret = await db.transaction((tx) => createWebhook(tx, channelId, sess.userId, name));
  log.info('webhook created', { channelId, webhookId: secret.id, actorId: sess.userId });
  const [row] = await db.select().from(webhooks).where(eq(webhooks.id, secret.id)).limit(1);
  sendJson(reply, 201, { webhook: { ...toWebhookInfo(row!), ...withUrl(secret) } });
}

async function handleUpdate(request: FastifyRequest<{ Params: WebhookParams }>, reply: FastifyReply): Promise<void> {
  const { channelId, webhookId } = request.params;
  const sess = await requireWebhookManager(request, reply, channelId);
  if (!sess) return;
  const webhook = await findChannelWebhook(channelId, webhookId);
  if (!webhook) return sendError(reply, 404, 'not_found', 'Webhook não encontrado.');
  const body = jsonBody(request.body);
  const updates: { name?: string; avatar?: string } = {};
  if (body.name !== undefined) {
    const name = sanitizeWebhookName(body.name);
    if (!name) return sendError(reply, 400, 'invalid_name', 'Dê um nome ao webhook.');
    updates.name = name;
  }
  if (body.avatar !== undefined) {
    const avatar = sanitizeAvatar(body.avatar);
    if (!avatar) updates.avatar = '';
    else if (isUploadedImage(avatar) && (await isOwnedProfileImage(avatar, sess.userId))) updates.avatar = avatar;
  }
  const [row] = await db.update(webhooks).set(updates).where(eq(webhooks.id, webhookId)).returning();
  if (updates.avatar !== undefined && webhook.avatar && webhook.avatar !== updates.avatar) {
    deleteAvatarFile(webhook.avatar).catch((err) => log.error('failed to delete old webhook avatar', err, { webhookId }));
  }
  sendJson(reply, 200, { webhook: toWebhookInfo(row ?? webhook) });
}

/** A leaked URL is fixed by rotating: the old token dies at once. Also the
 * only way to see a token again, since only its hash is kept. */
async function handleRotate(request: FastifyRequest<{ Params: WebhookParams }>, reply: FastifyReply): Promise<void> {
  const { channelId, webhookId } = request.params;
  const sess = await requireWebhookManager(request, reply, channelId);
  if (!sess) return;
  if (!floodControl.allow(`webhook-rotate:${sess.userId}`, { windowMs: 60_000, max: 10 })) {
    return sendError(reply, 429, 'rate_limited', 'Muitas trocas de token em pouco tempo. Espere um pouco.');
  }
  if (!(await findChannelWebhook(channelId, webhookId))) return sendError(reply, 404, 'not_found', 'Webhook não encontrado.');
  const secret = await rotateWebhookToken(webhookId);
  log.info('webhook token rotated', { channelId, webhookId });
  sendJson(reply, 200, { webhook: withUrl(secret) });
}

/** Its messages stay in the channel, shown as an unnamed bot. */
async function handleDelete(request: FastifyRequest<{ Params: WebhookParams }>, reply: FastifyReply): Promise<void> {
  const { channelId, webhookId } = request.params;
  if (!(await requireWebhookManager(request, reply, channelId))) return;
  const webhook = await findChannelWebhook(channelId, webhookId);
  if (!webhook) return sendError(reply, 404, 'not_found', 'Webhook não encontrado.');
  await db.delete(webhooks).where(eq(webhooks.id, webhookId));
  if (webhook.avatar) deleteAvatarFile(webhook.avatar).catch((err) => log.error('failed to delete webhook avatar', err, { webhookId }));
  sendJson(reply, 200, { ok: true });
}

export function registerBotRoutes(fastify: FastifyInstance): void {
  fastify.get('/api/channels/:channelId/webhooks', handleList);
  fastify.post('/api/channels/:channelId/webhooks', handleCreate);
  fastify.patch('/api/channels/:channelId/webhooks/:webhookId', handleUpdate);
  fastify.post('/api/channels/:channelId/webhooks/:webhookId/rotate', handleRotate);
  fastify.delete('/api/channels/:channelId/webhooks/:webhookId', handleDelete);
}
