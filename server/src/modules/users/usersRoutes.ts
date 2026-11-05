import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../../config/env.js';
import { sendJson, sendError, jsonBody } from '../../http/respond.js';
import { parseCookies } from '../../http/cookies.js';
import { resolveSession } from '../auth/session.js';
import { updateLocale } from '../auth/accounts.js';
import { isLocale } from './locale.js';
import { findById, publicUser } from './users.js';
import { friendsSince, listMutualFriends } from '../friendships/friendshipsRepository.js';
import { canViewProfile } from './profileAccess.js';
import { listSharedServers } from '../servers/serversRepository.js';

type Params = { userId: string };

/** `GET /api/users/:userId/profile` — the "perfil sob demanda" fetch for
 * when a profile isn't already in the client's known-users cache (e.g. the
 * author of an old message who has since left the server). Denial and
 * "doesn't exist" return the exact same 404 — same posture as
 * friendships.ts's `user_unavailable`, never confirm/deny based on a
 * relationship the caller doesn't already have. */
async function handleGetProfile(request: FastifyRequest<{ Params: Params }>, reply: FastifyReply): Promise<void> {
  const cookies = parseCookies(request.headers.cookie || '');
  const sess = await resolveSession(cookies[config.SESSION_COOKIE]);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');

  const targetId = String(request.params.userId || '');
  const target = targetId ? await findById(targetId) : null;
  if (!target || !(await canViewProfile(sess.userId, sess.role, target.id))) {
    return sendError(reply, 404, 'user_not_found', 'Conta não encontrada.');
  }
  sendJson(reply, 200, { user: publicUser(target) });
}

// a profile lists what two accounts have in common without paging it
const MUTUAL_LIST_LIMIT = 100;
const NONE = { items: [], total: 0 };

/** `GET /api/users/:userId/profile-details` — what the profile modal shows
 * besides the profile itself: since when the account exists, since when the
 * caller and it are friends, and the friends and servers they have in common.
 * Same access (and the same 404 for both "no" and "doesn't exist") as the
 * profile. Everything listed is already the caller's own: their friends,
 * their servers. */
async function handleGetProfileDetails(request: FastifyRequest<{ Params: Params }>, reply: FastifyReply): Promise<void> {
  const cookies = parseCookies(request.headers.cookie || '');
  const sess = await resolveSession(cookies[config.SESSION_COOKIE]);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');

  const targetId = String(request.params.userId || '');
  const target = targetId ? await findById(targetId) : null;
  if (!target || !(await canViewProfile(sess.userId, sess.role, target.id))) {
    return sendError(reply, 404, 'user_not_found', 'Conta não encontrada.');
  }
  const self = target.id === sess.userId;
  const [since, mutualFriends, mutualServers] = self
    ? [null, NONE, NONE]
    : await Promise.all([
      friendsSince(sess.userId, target.id),
      listMutualFriends(sess.userId, target.id, MUTUAL_LIST_LIMIT),
      listSharedServers(sess.userId, target.id, MUTUAL_LIST_LIMIT),
    ]);
  sendJson(reply, 200, {
    memberSince: target.createdAt.toISOString(),
    friendsSince: since ? since.toISOString() : null,
    mutualFriends,
    mutualServers,
  });
}

/** `PATCH /api/me/locale` — the account's UI language, which every device
 * picks up on its next /api/auth/me and which e-mails and push follow. */
async function handleSetLocale(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const cookies = parseCookies(request.headers.cookie || '');
  const sess = await resolveSession(cookies[config.SESSION_COOKIE]);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');

  const { locale } = jsonBody(request.body);
  if (!isLocale(locale)) return sendError(reply, 400, 'invalid_request', 'Idioma não suportado.');

  await updateLocale(sess.userId, locale);
  sendJson(reply, 200, { locale });
}

export function registerUserRoutes(fastify: FastifyInstance): void {
  fastify.patch('/api/me/locale', handleSetLocale);
  fastify.get('/api/users/:userId/profile', handleGetProfile);
  fastify.get('/api/users/:userId/profile-details', handleGetProfileDetails);
}
