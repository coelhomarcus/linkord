import type { FastifyReply, FastifyRequest } from 'fastify';
import { sendError } from '../../http/respond.js';
import { parseCookies } from '../../http/cookies.js';
import { resolveSession } from '../auth/session.js';
import type { AuditActor } from './auditLog.js';
import { adminCookieName, requireAdminOrigin } from './adminOrigin.js';

/** HTTP guard for /api/admin/*. 401 without a session, 403 for anyone who is
 * not an active admin RIGHT NOW. */
export async function requireAdminSession(request: FastifyRequest, reply: FastifyReply) {
  if (!requireAdminOrigin(request, reply)) return null;
  const cookies = parseCookies(request.headers.cookie || '');
  const sess = await resolveSession(cookies[adminCookieName()], 'admin');
  if (!sess) {
    sendError(reply, 401, 'unauthenticated', 'Não autenticado.');
    return null;
  }
  if (sess.role !== 'admin') {
    sendError(reply, 403, 'forbidden', 'Apenas administradores.');
    return null;
  }
  return sess;
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<AuditActor | null> {
  const sess = await requireAdminSession(request, reply);
  return sess ? { id: sess.userId, username: sess.username } : null;
}
