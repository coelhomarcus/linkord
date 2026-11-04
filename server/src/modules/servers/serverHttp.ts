import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../../config/env.js';
import { sendError } from '../../http/respond.js';
import { parseCookies } from '../../http/cookies.js';
import { resolveSession } from '../auth/session.js';
import { hasPermission } from './permissions.js';
import { basePermissionsIn, loadServerSnapshot, memberInput, type ServerSnapshot } from './serverAccess.js';
import type { MemberInput } from './permissions.js';

// The shared front door of every server route: who is asking, and what they
// may do in the server the URL names.

export async function requireSession(request: FastifyRequest, reply: FastifyReply): Promise<{ userId: string } | null> {
  const cookies = parseCookies(request.headers.cookie || '');
  const sess = await resolveSession(cookies[config.SESSION_COOKIE]);
  if (!sess) {
    sendError(reply, 401, 'unauthenticated', 'Não autenticado.');
    return null;
  }
  return sess;
}

export interface ServerActor {
  userId: string;
  snapshot: ServerSnapshot;
  member: MemberInput;
  permissions: number;
}

/** The caller as a member of an active server, holding `permission` there
 * (0: membership alone). A non-member gets 404 — whether a server exists is
 * not something an outsider learns — and a member without the permission 403. */
export async function requireServerMember(request: FastifyRequest, reply: FastifyReply, serverId: string, permission = 0): Promise<ServerActor | null> {
  const sess = await requireSession(request, reply);
  if (!sess) return null;
  const snapshot = await loadServerSnapshot(serverId);
  const member = snapshot ? memberInput(snapshot, sess.userId) : null;
  if (!snapshot || !member || snapshot.server.status !== 'active') {
    sendError(reply, 404, 'not_found', 'Servidor não encontrado.');
    return null;
  }
  const permissions = basePermissionsIn(snapshot, sess.userId);
  if (permission && !hasPermission(permissions, permission)) {
    sendError(reply, 403, 'forbidden', 'Você não tem permissão para fazer isso.');
    return null;
  }
  return { userId: sess.userId, snapshot, member, permissions };
}
