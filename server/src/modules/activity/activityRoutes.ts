import fs from 'node:fs/promises';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../../config/env.js';
import { parseCookies } from '../../http/cookies.js';
import { sendError, sendJson } from '../../http/respond.js';
import { resolveSession } from '../auth/session.js';
import { createDiscordAppClient } from '../../integrations/discord/discordApps.js';
import { createIgdbClient } from '../../integrations/igdb/igdb.js';
import { STEAM_ASSET_HOST } from '../../integrations/steam/steamAssets.js';
import { createSteamGridDbClient, STEAMGRIDDB_IMAGE_HOST } from '../../integrations/steamgriddb/steamgriddb.js';
import { fetchImage } from '../media-proxy/mediaProxy.js';
import * as floodControl from '../../realtime/floodControl.js';
import { postponeIgdb, reserveIgdbSlot } from '../games/igdbLimiter.js';
import { requireSession } from '../servers/serverHttp.js';
import { canViewProfile } from '../users/profileAccess.js';
import { findById } from '../users/users.js';
import { readActivityHistory, readOwnActivityHistory } from './activityHistory.js';
import { createDiscordActivityHandler, createDiscordActivityLookup } from './activityDiscord.js';
import { createActivityGameIconLookup } from './activityGameIcons.js';
import { ActivityGameError, createActivityGameLookup, parseActivityGameQuery } from './activityGames.js';
import { MAX_ACTIVITY_ICON_UPLOAD_BYTES, activityIconPath, isActivityIconId, storeActivityIcon } from './activityIcons.js';

const lookup = createActivityGameLookup({
  client: createIgdbClient({ clientId: config.IGDB_CLIENT_ID, clientSecret: config.IGDB_CLIENT_SECRET }),
  reserve: () => reserveIgdbSlot(),
  postpone: postponeIgdb,
});
const lookupIcon = createActivityGameIconLookup({
  client: createSteamGridDbClient({ apiKey: config.STEAMGRIDDB_API_KEY }),
  download: async (url) => {
    const { protocol, hostname } = new URL(url);
    if (protocol !== 'https:' || (hostname !== STEAMGRIDDB_IMAGE_HOST && hostname !== STEAM_ASSET_HOST)) throw new Error('not an image host');
    // a fixed host answers directly: a redirect could only lead somewhere else
    return (await fetchImage({ url, redirects: 0 })).body;
  },
  storeIcon: storeActivityIcon,
});
const handleDiscord = createDiscordActivityHandler({
  session: requireSession,
  lookup: createDiscordActivityLookup({
    client: createDiscordAppClient(),
    // through the SSRF guard and the media proxy's size cap, checked to be a picture
    download: async (source) => (await fetchImage(source)).body,
    storeIcon: storeActivityIcon,
  }),
});
const ICON_RULE = { windowMs: 60_000, max: 10 };

/** `GET /api/activity/game` — a detected game's IGDB name and its icon, or with `kind=using` an app's
 * icon (its name answered as asked: IGDB knows games only). */
async function handleGame(request: FastifyRequest<{ Querystring: { steam?: string; name?: string; ref?: string; kind?: string } }>, reply: FastifyReply): Promise<void> {
  const sess = await requireSession(request, reply);
  if (!sess) return;
  try {
    const query = parseActivityGameQuery({ steamAppId: request.query.steam, name: request.query.name, kind: request.query.kind });
    const [game, icon] = await Promise.all([
      query.kind === 'using' ? { name: query.name, image: null } : lookup(sess.userId, query),
      lookupIcon(sess.userId, query, isActivityIconId(request.query.ref) ? request.query.ref : null),
    ]);
    sendJson(reply, 200, { ...game, icon });
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

/** `GET /api/users/:userId/activity` — the profile's "Atividade recente": the games and apps the account
 * was last seen with, newest first. Same access and the same 404 for "no" and "doesn't exist" as the
 * profile; empty, with `sharing: false`, while the account does not share its activity. */
async function handleHistory(request: FastifyRequest<{ Params: { userId: string } }>, reply: FastifyReply): Promise<void> {
  const sess = await resolveSession(parseCookies(request.headers.cookie || '')[config.SESSION_COOKIE]);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');
  const targetId = String(request.params.userId || '');
  const target = targetId ? await findById(targetId) : null;
  if (!target || !(await canViewProfile(sess.userId, sess.role, target.id))) {
    return sendError(reply, 404, 'user_not_found', 'Conta não encontrada.');
  }
  const history = await readActivityHistory(target.id);
  if (!history) return sendError(reply, 404, 'user_not_found', 'Conta não encontrada.');
  sendJson(reply, 200, history);
}

/** `GET /api/activity/history` — the account's own history for its activity settings: every game and
 * app kept, hidden ones too and while it does not share, each with its icon. */
async function handleOwnHistory(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const sess = await requireSession(request, reply);
  if (!sess) return;
  sendJson(reply, 200, { items: await readOwnActivityHistory(sess.userId) });
}

export function registerActivityRoutes(fastify: FastifyInstance): void {
  fastify.get('/api/activity/game', handleGame);
  fastify.post('/api/activity/discord', { bodyLimit: 8 * 1024 }, handleDiscord);
  fastify.get('/api/activity/icons/:file', handleIcon);
  fastify.get('/api/activity/history', handleOwnHistory);
  fastify.get('/api/users/:userId/activity', handleHistory);
  // raw Buffer body, scoped so the wildcard parser doesn't reach the JSON routes
  fastify.register(async (scoped) => {
    scoped.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, payload, done) => done(null, payload));
    scoped.post('/api/activity/icons', { bodyLimit: MAX_ACTIVITY_ICON_UPLOAD_BYTES }, handleIconUpload);
  });
}
