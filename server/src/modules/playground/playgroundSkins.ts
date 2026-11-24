import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { config } from '../../config/env.js';
import { db } from '../../db/client.js';
import { playgroundSkins } from '../../db/schema.js';
import { parseCookies } from '../../http/cookies.js';
import { jsonBody, sendError, sendJson } from '../../http/respond.js';
import { resolveSession } from '../auth/session.js';
import { canViewProfile } from '../users/profileAccess.js';
import { findById } from '../users/users.js';
import { parseSkinPng } from './skinPng.js';

// The skin each account wears in a playground, kept with the account so it
// follows it across reloads and devices. Peers read it here whenever someone
// shows up in the call; the LiveKit packet that announces a change
// (web playgroundSession.ts) is only the fast path.

async function readSkin(userId: string): Promise<string | null> {
  const [row] = await db.select({ png: playgroundSkins.png }).from(playgroundSkins).where(eq(playgroundSkins.userId, userId)).limit(1);
  return row?.png ?? null;
}

/** `GET /api/users/:userId/playground-skin` — `{ skin }`, a base64 PNG or null for the account's
 * default. Same access, and the same 404 for "no" and "doesn't exist", as the profile. */
async function handleGetSkin(request: FastifyRequest<{ Params: { userId: string } }>, reply: FastifyReply): Promise<void> {
  const sess = await resolveSession(parseCookies(request.headers.cookie || '')[config.SESSION_COOKIE]);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');

  const targetId = String(request.params.userId || '');
  const target = targetId ? await findById(targetId) : null;
  if (!target || !(await canViewProfile(sess.userId, sess.role, target.id))) {
    return sendError(reply, 404, 'user_not_found', 'Conta não encontrada.');
  }
  reply.header('cache-control', 'no-store');
  sendJson(reply, 200, { skin: await readSkin(target.id) });
}

/** `PUT /api/me/playground-skin` — `{ skin }`, a base64 PNG of 64×64 or 64×32. */
async function handlePutSkin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const sess = await resolveSession(parseCookies(request.headers.cookie || '')[config.SESSION_COOKIE]);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');

  const png = parseSkinPng(jsonBody(request.body).skin);
  if (!png) return sendError(reply, 400, 'invalid_request', 'Skin inválida.');
  await db.insert(playgroundSkins).values({ userId: sess.userId, png })
    .onConflictDoUpdate({ target: playgroundSkins.userId, set: { png, updatedAt: new Date() } });
  sendJson(reply, 200, { skin: png });
}

/** `DELETE /api/me/playground-skin` — back to the account's default. */
async function handleDeleteSkin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const sess = await resolveSession(parseCookies(request.headers.cookie || '')[config.SESSION_COOKIE]);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');

  await db.delete(playgroundSkins).where(eq(playgroundSkins.userId, sess.userId));
  reply.code(204).send();
}

export function registerPlaygroundRoutes(fastify: FastifyInstance): void {
  fastify.get('/api/users/:userId/playground-skin', handleGetSkin);
  fastify.put('/api/me/playground-skin', handlePutSkin);
  fastify.delete('/api/me/playground-skin', handleDeleteSkin);
}
