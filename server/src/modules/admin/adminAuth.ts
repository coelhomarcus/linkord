import { eq } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { db } from '../../db/client.js';
import { users } from '../../db/schema.js';
import { sendError } from '../../http/respond.js';
import { sessionTokenFromHeaders } from '../../http/cookies.js';
import { resolveSession } from '../auth/session.js';
import type { AuditActor } from './auditLog.js';

/** The role and status a session (or a live socket) carries are snapshots —
 * up to 60 s stale in the session cache and frozen for the life of a socket.
 * Every administrative decision re-reads the row instead (§7.5), so demoting
 * or suspending an admin takes effect on their very next action. */
export async function isActiveAdmin(userId: string): Promise<boolean> {
  const [row] = await db.select({ role: users.role, status: users.status }).from(users).where(eq(users.id, userId)).limit(1);
  return row?.role === 'admin' && row.status === 'active';
}

/** HTTP guard for /api/admin/*. 401 without a session, 403 for anyone who is
 * not an active admin RIGHT NOW. */
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<AuditActor | null> {
  const sess = await resolveSession(sessionTokenFromHeaders(request.headers));
  if (!sess) {
    sendError(reply, 401, 'unauthenticated', 'Não autenticado.');
    return null;
  }
  if (!(await isActiveAdmin(sess.userId))) {
    sendError(reply, 403, 'forbidden', 'Apenas administradores.');
    return null;
  }
  return { id: sess.userId, username: sess.username };
}
