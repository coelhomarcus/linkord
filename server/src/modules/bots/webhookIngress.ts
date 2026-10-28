import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../../config/env.js';
import { sendJson, sendError, jsonBody } from '../../http/respond.js';
import * as floodControl from '../../realtime/floodControl.js';
import { postBotMessage } from '../messages/messages.js';
import { findWebhookByCredentials, markWebhookUsed } from './webhooksRepository.js';
import { parseRichEmbeds } from './richEmbeds.js';
import { logger } from '../../lib/logger.js';

const log = logger.child({ component: 'webhooks' });

// The public door outside systems post through. No session: the webhook's
// token is the whole credential, in the path (for tools that only take a
// URL) or as `Authorization: Bearer` (for those that can keep it out of
// their own logs). The path is never logged with it, see http/requestPath.ts.

// the IP cap only stops someone guessing at ids/tokens from one place; a
// legitimate sender is held by its own webhook's cap below
const PER_IP_LIMIT = { windowMs: 60_000, max: 120 };
const PER_WEBHOOK_LIMIT = { windowMs: 60_000, max: 30 };
// the text (MAX_CHAT_LEN) plus up to five full embeds, with room for JSON
// escaping, without accepting arbitrary payloads
const BODY_LIMIT_BYTES = 64 * 1024;
const MAX_DELIVERY_KEY_LEN = 128;

type IngressParams = { webhookId: string; token?: string };

function bearerToken(request: FastifyRequest): string {
  const header = request.headers.authorization;
  return typeof header === 'string' && header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
}

/** Undefined when absent, null when present but unusable. */
function deliveryKeyOf(request: FastifyRequest): string | null | undefined {
  const raw = request.headers['idempotency-key'];
  if (raw === undefined) return undefined;
  const key = typeof raw === 'string' ? raw.trim() : '';
  return key && key.length <= MAX_DELIVERY_KEY_LEN && /^[\x21-\x7e]+$/.test(key) ? key : null;
}

function tooFast(reply: FastifyReply, key: string, rule: { windowMs: number; max: number }): void {
  reply.header('Retry-After', String(Math.ceil(floodControl.retryAfterMs(key, rule) / 1000) || 1));
  sendError(reply, 429, 'rate_limited', 'Muitas mensagens em pouco tempo. Tente de novo em instantes.');
}

async function handleIngress(request: FastifyRequest<{ Params: IngressParams }>, reply: FastifyReply): Promise<void> {
  const ipKey = `webhook-ip:${request.ip}`;
  if (!floodControl.allow(ipKey, PER_IP_LIMIT)) return tooFast(reply, ipKey, PER_IP_LIMIT);

  const webhookId = String(request.params.webhookId || '');
  const token = request.params.token ?? bearerToken(request);
  const webhook = webhookId && token ? await findWebhookByCredentials(webhookId, token) : null;
  if (!webhook) return sendError(reply, 401, 'invalid_webhook', 'Webhook inválido.');

  const webhookKey = `webhook:${webhook.id}`;
  if (!floodControl.allow(webhookKey, PER_WEBHOOK_LIMIT)) return tooFast(reply, webhookKey, PER_WEBHOOK_LIMIT);

  const body = jsonBody(request.body);
  const text = typeof body.content === 'string' ? body.content.trim() : '';
  const parsed = parseRichEmbeds(body.embeds);
  if ('error' in parsed) return sendError(reply, 400, 'invalid_message', parsed.error);
  if (!text && !parsed.embeds.length) return sendError(reply, 400, 'invalid_message', 'Envie o texto em "content" ou ao menos um item em "embeds".');
  // never cut it silently: the sender would think it all went through
  if (text.length > config.MAX_CHAT_LEN) return sendError(reply, 400, 'message_too_long', `A mensagem passa de ${config.MAX_CHAT_LEN} caracteres.`);
  const deliveryKey = deliveryKeyOf(request);
  if (deliveryKey === null) return sendError(reply, 400, 'invalid_request', `Idempotency-Key inválida (até ${MAX_DELIVERY_KEY_LEN} caracteres visíveis).`);

  const { message, duplicate } = await postBotMessage({ conversationId: webhook.conversationId, webhookId: webhook.id, text, richEmbeds: parsed.embeds, deliveryKey: deliveryKey ?? null });
  void markWebhookUsed(webhook.id).catch((err) => log.error('failed to record webhook use', err, { webhookId: webhook.id }));
  sendJson(reply, duplicate ? 200 : 201, { id: message.msgId, duplicate });
}

export function registerWebhookIngressRoutes(fastify: FastifyInstance): void {
  fastify.post('/api/webhooks/:webhookId/:token', { bodyLimit: BODY_LIMIT_BYTES }, handleIngress);
  fastify.post('/api/webhooks/:webhookId', { bodyLimit: BODY_LIMIT_BYTES }, handleIngress);
}
