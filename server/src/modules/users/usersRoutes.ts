import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../../config/env.js';
import { sendJson, sendError, jsonBody } from '../../http/respond.js';
import { parseCookies } from '../../http/cookies.js';
import { resolveSession } from '../auth/session.js';
import { updateLocale } from '../auth/accounts.js';
import { isLocale } from './locale.js';
import { seedPreferences, updatePreferences } from './preferences.js';
import { parsePreferenceChanges } from './preferencesPolicy.js';
import { findById, publicUser } from './users.js';
import { friendsSince, listMutualFriends } from '../friendships/friendshipsRepository.js';
import { canViewProfile } from './profileAccess.js';
import { listSharedServers } from '../servers/serversRepository.js';
import { readPublicSteamConnection } from '../connections/connections.js';
import { listUserBadges } from '../badges/badgesRepository.js';

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
 * profile. The Steam label belongs to a connection already shown on the profile. `badges` is
 * empty for an account with none, in catalog order otherwise. */
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
  const [since, mutualFriends, mutualServers, steamConnection, badges] = await Promise.all([
    self ? null : friendsSince(sess.userId, target.id),
    self ? NONE : listMutualFriends(sess.userId, target.id, MUTUAL_LIST_LIMIT),
    self ? NONE : listSharedServers(sess.userId, target.id, MUTUAL_LIST_LIMIT),
    readPublicSteamConnection(target.id, target.profileLinks),
    listUserBadges(target.id),
  ]);
  sendJson(reply, 200, {
    memberSince: target.createdAt.toISOString(),
    friendsSince: since ? since.toISOString() : null,
    mutualFriends,
    mutualServers,
    badges: badges.map(({ id, grantedAt }) => ({ id, grantedAt })),
    ...(steamConnection && { steamConnection }),
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

/** `PATCH /api/me/preferences` — `{ changes: { key: value | null } }`, null putting a key back to its
 * default. Every tab of the account hears `my-preferences`. */
async function handleUpdatePreferences(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const cookies = parseCookies(request.headers.cookie || '');
  const sess = await resolveSession(cookies[config.SESSION_COOKIE]);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');

  const changes = parsePreferenceChanges(jsonBody(request.body).changes);
  if (!changes) return sendError(reply, 400, 'invalid_request', 'Preferência inválida.');
  const preferences = await updatePreferences(sess.userId, changes);
  if (preferences === 'too_many') return sendError(reply, 400, 'invalid_request', 'Preferências demais.');
  sendJson(reply, 200, { preferences });
}

/** `POST /api/me/preferences/seed` — `{ values }`, what the first device to sign in after the account had
 * none had saved. A later seed changes nothing and gets the account's values back. */
async function handleSeedPreferences(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const cookies = parseCookies(request.headers.cookie || '');
  const sess = await resolveSession(cookies[config.SESSION_COOKIE]);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');

  const values = parsePreferenceChanges(jsonBody(request.body).values, { allowNull: false });
  if (!values) return sendError(reply, 400, 'invalid_request', 'Preferência inválida.');
  const preferences = await seedPreferences(sess.userId, values);
  if (preferences === 'too_many') return sendError(reply, 400, 'invalid_request', 'Preferências demais.');
  sendJson(reply, 200, { preferences });
}

export function registerUserRoutes(fastify: FastifyInstance): void {
  fastify.patch('/api/me/locale', handleSetLocale);
  fastify.patch('/api/me/preferences', handleUpdatePreferences);
  fastify.post('/api/me/preferences/seed', handleSeedPreferences);
  fastify.get('/api/users/:userId/profile', handleGetProfile);
  fastify.get('/api/users/:userId/profile-details', handleGetProfileDetails);
}
