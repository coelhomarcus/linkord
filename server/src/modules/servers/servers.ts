import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { serverBans, servers, users } from '../../db/schema.js';
import { sendJson, sendError, jsonBody } from '../../http/respond.js';
import * as floodControl from '../../realtime/floodControl.js';
import { isUploadedImage, sanitizeAvatar } from '../profile/sanitize.js';
import { deleteAvatarFile, isOwnedProfileImage } from '../attachments/attachmentCleanup.js';
import { serverCreationBlockedBy } from '../limits/limits.js';
import { findById, toSocialUser } from '../users/users.js';
import { resolveLocale } from '../users/locale.js';
import { PERMISSIONS } from './permissions.js';
import { invalidateServer, loadServerSnapshot } from './serverAccess.js';
import { createServer, sanitizeServerName } from './serversRepository.js';
import { buildServerSummary, sendServerUpdateToMembers } from './serverSummaries.js';
import { removeMember, reorderServersForUser, transferOwnership, unbanMember, type RemoveMemberResult } from './serverMembership.js';
import { deleteServerCompletely } from './serverDeletion.js';
import { pageServerMembers } from './serverMembers.js';
import { createInvitations, normalizeInviteeIds, type InviteResult } from './serverInvitationsRepository.js';
import { requireServerMember, requireSession } from './serverHttp.js';
import { diffFields, listServerAudit, recordServerAudit, SERVER_AUDIT_ACTIONS } from './serverAuditLog.js';
import { logger } from '../../lib/logger.js';

const log = logger.child({ component: 'servers' });

// HTTP surface of a server's own life: create, rename, re-icon, delete,
// leave, members, kicks, bans and ownership. Channels, roles and invites
// have their own route files next to this one.

type ServerParams = { serverId: string };
type MemberParams = { serverId: string; userId: string };

/** Creates the server from the template (its creator is the only member)
 * and invites the chosen friends — answered only AFTER the server exists,
 * with each invitation's own result. */
async function handleCreate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const sess = await requireSession(request, reply);
  if (!sess) return;
  if (!floodControl.allow(`server-create:${sess.userId}`, { windowMs: 60_000, max: 10 })) {
    return sendError(reply, 429, 'rate_limited', 'Você está criando servidores rápido demais. Espere um pouco.');
  }
  const body = jsonBody(request.body);
  const name = sanitizeServerName(body.name);
  if (!name) return sendError(reply, 400, 'invalid_name', 'Dê um nome ao servidor.');
  const { ids, tooMany } = normalizeInviteeIds(body.inviteeIds, sess.userId);
  if (tooMany) return sendError(reply, 400, 'too_many_invitees', 'Convide menos pessoas por vez.');
  if (await serverCreationBlockedBy(sess.userId)) {
    return sendError(reply, 409, 'quota_exceeded', 'Você atingiu o limite de servidores. Saia ou apague algum antes de criar outro.');
  }
  const owner = await findById(sess.userId);
  const { serverId, firstTextChannelId } = await createServer(sess.userId, name, resolveLocale(owner?.locale));
  await sendServerUpdateToMembers(serverId, 'server-created');
  let results: InviteResult[] = [];
  if (ids.length) {
    const invited = await createInvitations(sess.userId, serverId, ids);
    if ('results' in invited) results = invited.results;
  }
  const snapshot = await loadServerSnapshot(serverId);
  log.info('server created', { serverId, ownerId: sess.userId });
  sendJson(reply, 201, { server: snapshot ? buildServerSummary(snapshot, sess.userId) : null, channelId: firstTextChannelId, results });
}

async function handleUpdate(request: FastifyRequest<{ Params: ServerParams }>, reply: FastifyReply): Promise<void> {
  const serverId = String(request.params.serverId || '');
  const actor = await requireServerMember(request, reply, serverId, PERMISSIONS.MANAGE_SERVER);
  if (!actor) return;
  const body = jsonBody(request.body);
  const updates: { name?: string; icon?: string; updatedAt: Date } = { updatedAt: new Date() };
  if (body.name !== undefined) {
    const name = sanitizeServerName(body.name);
    if (!name) return sendError(reply, 400, 'invalid_name', 'Dê um nome ao servidor.');
    updates.name = name;
  }
  if (body.icon !== undefined) {
    const icon = sanitizeAvatar(body.icon);
    // same rules an account's own avatar gets: a new picture is only ever an
    // upload, and only one the caller uploaded — otherwise whoever manages
    // the server could claim another account's /uploads/<id>, and its later
    // replacement would delete that real owner's file
    if (!icon) updates.icon = '';
    else if (isUploadedImage(icon) && (await isOwnedProfileImage(icon, actor.userId))) updates.icon = icon;
  }
  if (updates.name === undefined && updates.icon === undefined) return sendJson(reply, 200, { ok: true });
  const previousIcon = actor.snapshot.server.icon;
  const changes = diffFields({ name: actor.snapshot.server.name, icon: previousIcon }, updates, ['name', 'icon']);
  await db.transaction(async (tx) => {
    await tx.update(servers).set(updates).where(eq(servers.id, serverId));
    if (changes.length) await recordServerAudit(tx, { serverId, actorId: actor.userId, action: 'server.update', targetType: 'server', targetId: serverId, targetLabel: updates.name ?? actor.snapshot.server.name, changes });
  });
  invalidateServer(serverId);
  if (updates.icon !== undefined && previousIcon && previousIcon !== updates.icon) {
    deleteAvatarFile(previousIcon).catch((err) => log.error('failed to delete old server icon', err, { serverId }));
  }
  await sendServerUpdateToMembers(serverId);
  sendJson(reply, 200, { ok: true });
}

async function handleDelete(request: FastifyRequest<{ Params: ServerParams }>, reply: FastifyReply): Promise<void> {
  const serverId = String(request.params.serverId || '');
  const actor = await requireServerMember(request, reply, serverId);
  if (!actor) return;
  if (!actor.member.isOwner) return sendError(reply, 403, 'forbidden', 'Só o dono pode apagar o servidor.');
  const deleted = await deleteServerCompletely(serverId);
  if (deleted) log.info('server deleted by its owner', { serverId, ownerId: actor.userId, members: deleted.memberIds.length });
  sendJson(reply, 200, { ok: true });
}

function respondRemoval(reply: FastifyReply, result: RemoveMemberResult): void {
  switch (result.code) {
    case 'ok': return sendJson(reply, 200, { ok: true, serverDeleted: result.serverDeleted });
    case 'not_found': return sendError(reply, 404, 'not_found', 'Servidor não encontrado.');
    case 'not_member': return sendError(reply, 404, 'user_not_found', 'Essa pessoa não está no servidor.');
    case 'forbidden': return sendError(reply, 403, 'forbidden', 'Você não pode remover essa pessoa.');
    case 'owner_must_transfer': return sendError(reply, 409, 'owner_must_transfer', 'Transfira a propriedade do servidor antes de sair.');
  }
}

async function handleLeave(request: FastifyRequest<{ Params: ServerParams }>, reply: FastifyReply): Promise<void> {
  const sess = await requireSession(request, reply);
  if (!sess) return;
  respondRemoval(reply, await removeMember(String(request.params.serverId || ''), sess.userId, sess.userId, 'leave'));
}

async function handleKick(request: FastifyRequest<{ Params: MemberParams }>, reply: FastifyReply): Promise<void> {
  const sess = await requireSession(request, reply);
  if (!sess) return;
  const serverId = String(request.params.serverId || '');
  const targetId = String(request.params.userId || '');
  const result = await removeMember(serverId, sess.userId, targetId, 'kick');
  if (result.code === 'ok') log.info('member kicked', { serverId, actorId: sess.userId, targetId });
  respondRemoval(reply, result);
}

async function handleBan(request: FastifyRequest<{ Params: MemberParams }>, reply: FastifyReply): Promise<void> {
  const sess = await requireSession(request, reply);
  if (!sess) return;
  const serverId = String(request.params.serverId || '');
  const targetId = String(request.params.userId || '');
  const body = request.body ? jsonBody(request.body) : {};
  const result = await removeMember(serverId, sess.userId, targetId, 'ban', typeof body.reason === 'string' ? body.reason : '');
  if (result.code === 'ok') log.info('member banned', { serverId, actorId: sess.userId, targetId });
  respondRemoval(reply, result);
}

async function handleUnban(request: FastifyRequest<{ Params: MemberParams }>, reply: FastifyReply): Promise<void> {
  const serverId = String(request.params.serverId || '');
  const actor = await requireServerMember(request, reply, serverId, PERMISSIONS.BAN_MEMBERS);
  if (!actor) return;
  if (!(await unbanMember(serverId, actor.userId, String(request.params.userId || '')))) return sendError(reply, 404, 'not_found', 'Essa pessoa não está banida.');
  sendJson(reply, 200, { ok: true });
}

async function handleListBans(request: FastifyRequest<{ Params: ServerParams }>, reply: FastifyReply): Promise<void> {
  const serverId = String(request.params.serverId || '');
  const actor = await requireServerMember(request, reply, serverId, PERMISSIONS.BAN_MEMBERS);
  if (!actor) return;
  const rows = await db.select({ user: users, reason: serverBans.reason, createdAt: serverBans.createdAt })
    .from(serverBans).innerJoin(users, eq(users.id, serverBans.userId))
    .where(eq(serverBans.serverId, serverId)).orderBy(desc(serverBans.createdAt));
  sendJson(reply, 200, { items: rows.map((r) => ({ user: toSocialUser(r.user), reason: r.reason, at: r.createdAt.toISOString() })) });
}

async function handleTransfer(request: FastifyRequest<{ Params: ServerParams }>, reply: FastifyReply): Promise<void> {
  const sess = await requireSession(request, reply);
  if (!sess) return;
  const serverId = String(request.params.serverId || '');
  const body = jsonBody(request.body);
  const result = await transferOwnership(serverId, sess.userId, String(body.userId || ''));
  if (result.code === 'not_found') return sendError(reply, 404, 'not_found', 'Servidor não encontrado.');
  if (result.code === 'forbidden') return sendError(reply, 403, 'forbidden', 'Só o dono pode transferir o servidor.');
  if (result.code === 'not_member') return sendError(reply, 404, 'user_not_found', 'Essa pessoa não está no servidor.');
  log.info('server ownership transferred', { serverId, from: sess.userId, to: body.userId });
  sendJson(reply, 200, { ok: true });
}

async function handleMembers(request: FastifyRequest<{ Params: ServerParams; Querystring: { cursor?: string } }>, reply: FastifyReply): Promise<void> {
  const serverId = String(request.params.serverId || '');
  const actor = await requireServerMember(request, reply, serverId);
  if (!actor) return;
  const page = await pageServerMembers(serverId, request.query.cursor);
  if (page === 'not_found') return sendError(reply, 404, 'not_found', 'Servidor não encontrado.');
  if (page === 'invalid_cursor') return sendError(reply, 400, 'invalid_cursor', 'Cursor inválido.');
  sendJson(reply, 200, page);
}

type AuditQuery = { action?: string; actor?: string; target?: string; from?: string; to?: string; cursor?: string };

/** The server's audit log, filtered by action, actor, target and period. A
 * member without VIEW_AUDIT_LOG gets 403, an outsider 404 — like any other
 * server route. */
async function handleAuditLog(request: FastifyRequest<{ Params: ServerParams; Querystring: AuditQuery }>, reply: FastifyReply): Promise<void> {
  const serverId = String(request.params.serverId || '');
  const actor = await requireServerMember(request, reply, serverId, PERMISSIONS.VIEW_AUDIT_LOG);
  if (!actor) return;
  const q = request.query;
  const text = (value: unknown) => (typeof value === 'string' ? value.trim().slice(0, 128) : '') || undefined;
  const action = text(q.action);
  if (action && !(SERVER_AUDIT_ACTIONS as readonly string[]).includes(action)) return sendError(reply, 400, 'invalid_request', 'Ação desconhecida.');
  const page = await listServerAudit(serverId, { action, actorId: text(q.actor), targetId: text(q.target), from: text(q.from), to: text(q.to) }, text(q.cursor));
  if (page === 'invalid_cursor') return sendError(reply, 400, 'invalid_cursor', 'Cursor inválido.');
  sendJson(reply, 200, page);
}

async function handleReorder(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const sess = await requireSession(request, reply);
  if (!sess) return;
  const body = jsonBody(request.body);
  const ids = Array.isArray(body.serverIds) ? body.serverIds.filter((v): v is string => typeof v === 'string').slice(0, 500) : [];
  await reorderServersForUser(sess.userId, ids);
  sendJson(reply, 200, { ok: true });
}

export function registerServerRoutes(fastify: FastifyInstance): void {
  fastify.post('/api/servers', handleCreate);
  fastify.put('/api/servers/order', handleReorder);
  fastify.patch('/api/servers/:serverId', handleUpdate);
  fastify.delete('/api/servers/:serverId', handleDelete);
  fastify.post('/api/servers/:serverId/leave', handleLeave);
  fastify.post('/api/servers/:serverId/transfer', handleTransfer);
  fastify.get('/api/servers/:serverId/members', handleMembers);
  fastify.get('/api/servers/:serverId/audit-log', handleAuditLog);
  fastify.delete('/api/servers/:serverId/members/:userId', handleKick);
  fastify.get('/api/servers/:serverId/bans', handleListBans);
  fastify.put('/api/servers/:serverId/bans/:userId', handleBan);
  fastify.delete('/api/servers/:serverId/bans/:userId', handleUnban);
}
