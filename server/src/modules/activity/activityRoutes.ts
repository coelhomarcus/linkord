import fs from 'node:fs/promises';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../../config/env.js';
import { sendError, sendJson } from '../../http/respond.js';
import { createIgdbClient } from '../../integrations/igdb/igdb.js';
import * as floodControl from '../../realtime/floodControl.js';
import { postponeIgdb, reserveIgdbSlot } from '../games/igdbLimiter.js';
import { requireSession } from '../servers/serverHttp.js';
import { ActivityGameError, createActivityGameLookup } from './activityGames.js';
import { MAX_ACTIVITY_ICON_UPLOAD_BYTES, activityIconPath, isActivityIconId, storeActivityIcon } from './activityIcons.js';

const lookup = createActivityGameLookup({
  client: createIgdbClient({ clientId: config.IGDB_CLIENT_ID, clientSecret: config.IGDB_CLIENT_SECRET }),
  reserve: () => reserveIgdbSlot(),
  postpone: postponeIgdb,
});
const ICON_RULE = { windowMs: 60_000, max: 10 };

async function handleGame(request: FastifyRequest<{ Querystring: { steam?: string; name?: string } }>, reply: FastifyReply): Promise<void> {
  const sess = await requireSession(request, reply);
  if (!sess) return;
  try {
    sendJson(reply, 200, await lookup(sess.userId, { steamAppId: request.query.steam, name: request.query.name }));
  } catch (error) {
    if (!(error instanceof ActivityGameError)) throw error;
    if (error.status === 429) reply.header('Retry-After', String(Math.max(1, Math.ceil(error.retryAfterMs / 1000))));
    sendError(reply, error.status, error.code, error.status === 429 ? 'Muitas buscas. Tente novamente em instantes.' : 'Busca inválida.');
  }
}

async function handleIconUpload(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const sess = await requireSession(request, reply);
  if (!sess) return;
  const key = `activity-icon:${sess.userId}`;
  if (!floodControl.allow(key, ICON_RULE)) {
    reply.header('Retry-After', String(Math.max(1, Math.ceil(floodControl.retryAfterMs(key, ICON_RULE) / 1000))));
    return sendError(reply, 429, 'rate_limited', 'Muitos envios. Tente novamente em instantes.');
  }
  const body = request.body;
  if (!Buffer.isBuffer(body) || body.length === 0) return sendError(reply, 400, 'invalid_image', 'Imagem inválida.');
  const stored = await storeActivityIcon(body);
  if (stored === 'invalid_image') return sendError(reply, 400, 'invalid_image', 'Imagem inválida.');
  if (stored === 'too_large') return sendError(reply, 413, 'image_too_large', 'Imagem grande demais.');
  sendJson(reply, 200, stored);
}

async function handleIcon(request: FastifyRequest<{ Params: { file: string } }>, reply: FastifyReply): Promise<void> {
  const sess = await requireSession(request, reply);
  if (!sess) return;
  const id = String(request.params.file || '').replace(/\.webp$/, '');
  if (!isActivityIconId(id)) return sendError(reply, 404, 'not_found', 'Ícone não encontrado.');
  let buffer: Buffer;
  try {
    buffer = await fs.readFile(activityIconPath(id));
  } catch {
    return sendError(reply, 404, 'not_found', 'Ícone não encontrado.');
  }
  reply.code(200)
    .header('Content-Type', 'image/webp')
    .header('Cache-Control', 'private, max-age=31536000, immutable')
    .header('X-Content-Type-Options', 'nosniff')
    .send(buffer);
}

export function registerActivityRoutes(fastify: FastifyInstance): void {
  fastify.get('/api/activity/game', handleGame);
  fastify.get('/api/activity/icons/:file', handleIcon);
  // raw Buffer body, scoped so the wildcard parser doesn't reach the JSON routes
  fastify.register(async (scoped) => {
    scoped.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, payload, done) => done(null, payload));
    scoped.post('/api/activity/icons', { bodyLimit: MAX_ACTIVITY_ICON_UPLOAD_BYTES }, handleIconUpload);
  });
}
