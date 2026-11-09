import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, eq, gt, gte, inArray, sql } from 'drizzle-orm';
import { config } from '../../config/env.js';
import { db } from '../../db/client.js';
import { serverMemberRoles, serverRoles } from '../../db/schema.js';
import { sendJson, sendError, jsonBody } from '../../http/respond.js';
import { ALL_PERMISSIONS, canManageRole, hasPermission, highestRolePosition, outranks, PERMISSIONS } from './permissions.js';
import { enforceCallPermissions } from '../calls/callPermissions.js';
import { invalidateServer, memberInput } from './serverAccess.js';
import { broadcastToServerMembers, sendServerUpdateToMembers } from './serverSummaries.js';
import { requireServerMember, requireSession, type ServerActor } from './serverHttp.js';
import { lockServer } from './serversRepository.js';
import { createdFields, deletedFields, diffFields, recordServerAudit } from './serverAuditLog.js';

// Roles: creating, editing, ordering and handing them out. The hierarchy
// rule runs through all of it — nobody touches a role at or above their own
// highest one, nor grants a permission they don't hold themselves (not even
// by handing out a lower role that carries it). Writes that move positions
// hold the server row lock, so positions stay 1..n without duplicates.

type ServerParams = { serverId: string };
type RoleParams = { roleId: string };
type MemberParams = { serverId: string; userId: string };

const COLOR_RE = /^#[0-9a-f]{6}$/i;

function sanitizeRoleName(name: unknown): string | null {
  const s = String(name == null ? '' : name).replace(/[\r\n\t]+/g, ' ').trim().slice(0, 100);
  return s || null;
}

async function changed(serverId: string): Promise<void> {
  invalidateServer(serverId);
  await sendServerUpdateToMembers(serverId);
  void enforceCallPermissions(serverId);
}

function grantable(actor: ServerActor): number {
  return hasPermission(actor.permissions, PERMISSIONS.ADMINISTRATOR) ? ALL_PERMISSIONS : actor.permissions;
}

async function requireRoleManager(request: FastifyRequest, reply: FastifyReply, roleId: string) {
  const sess = await requireSession(request, reply);
  if (!sess) return null;
  const [row] = await db.select({ serverId: serverRoles.serverId }).from(serverRoles).where(eq(serverRoles.id, roleId)).limit(1);
  if (!row) {
    sendError(reply, 404, 'not_found', 'Cargo não encontrado.');
    return null;
  }
  const actor = await requireServerMember(request, reply, row.serverId, PERMISSIONS.MANAGE_ROLES);
  if (!actor) return null;
  const role = actor.snapshot.roles.find((r) => r.id === roleId)!;
  if (!role.isDefault && !canManageRole(actor.member, role, actor.snapshot.roles)) {
    sendError(reply, 403, 'hierarchy', 'Esse cargo está acima do seu.');
    return null;
  }
  return { actor, role };
}

async function handleCreate(request: FastifyRequest<{ Params: ServerParams }>, reply: FastifyReply): Promise<void> {
  const serverId = String(request.params.serverId || '');
  const actor = await requireServerMember(request, reply, serverId, PERMISSIONS.MANAGE_ROLES);
  if (!actor) return;
  if (actor.snapshot.roles.length >= config.MAX_ROLES_PER_SERVER) return sendError(reply, 409, 'quota_exceeded', 'O servidor já tem o máximo de cargos.');
  const body = jsonBody(request.body);
  const name = sanitizeRoleName(body.name);
  if (!name) return sendError(reply, 400, 'invalid_name', 'Dê um nome ao cargo.');
  const permissions = Number(body.permissions ?? 0) & ALL_PERMISSIONS;
  if ((permissions & ~grantable(actor)) !== 0) return sendError(reply, 403, 'hierarchy', 'Você não pode dar permissões que você não tem.');
  const id = crypto.randomUUID();
  const color = typeof body.color === 'string' && COLOR_RE.test(body.color) ? body.color.toLowerCase() : '';
  // new roles start at the bottom, right above @everyone
  await db.transaction(async (tx) => {
    // without the lock, two creates both shift the same rows and both insert at 1
    await lockServer(tx, serverId);
    await tx.update(serverRoles).set({ position: sql`${serverRoles.position} + 1` })
      .where(and(eq(serverRoles.serverId, serverId), gte(serverRoles.position, 1)));
    await tx.insert(serverRoles).values({
      id, serverId, name, position: 1, permissions, color,
      hoist: body.hoist === true, mentionable: body.mentionable === true,
    });
    await recordServerAudit(tx, {
      serverId, actorId: actor.userId, action: 'role.create', targetType: 'role', targetId: id, targetLabel: name,
      changes: createdFields({ name, color, permissions }),
    });
  });
  await changed(serverId);
  sendJson(reply, 201, { roleId: id });
}

async function handleUpdate(request: FastifyRequest<{ Params: RoleParams }>, reply: FastifyReply): Promise<void> {
  const roleId = String(request.params.roleId || '');
  const target = await requireRoleManager(request, reply, roleId);
  if (!target) return;
  const { actor, role } = target;
  const body = jsonBody(request.body);
  const updates: Partial<{ name: string; color: string; permissions: number; hoist: boolean; mentionable: boolean }> = {};
  if (body.name !== undefined && !role.isDefault) {
    const name = sanitizeRoleName(body.name);
    if (!name) return sendError(reply, 400, 'invalid_name', 'Dê um nome ao cargo.');
    updates.name = name;
  }
  if (body.color !== undefined) updates.color = typeof body.color === 'string' && COLOR_RE.test(body.color) ? body.color.toLowerCase() : '';
  if (body.permissions !== undefined) {
    const permissions = Number(body.permissions) & ALL_PERMISSIONS;
    // only the bits that change need to be the actor's to give or take
    if (((permissions ^ role.permissions) & ~grantable(actor)) !== 0) return sendError(reply, 403, 'hierarchy', 'Você não pode mexer em permissões que você não tem.');
    updates.permissions = permissions;
  }
  if (body.hoist !== undefined && !role.isDefault) updates.hoist = body.hoist === true;
  if (body.mentionable !== undefined && !role.isDefault) updates.mentionable = body.mentionable === true;
  const changes = diffFields(role, updates, ['name', 'color', 'permissions', 'hoist', 'mentionable']);
  if (changes.length) {
    await db.transaction(async (tx) => {
      await tx.update(serverRoles).set(updates).where(eq(serverRoles.id, roleId));
      await recordServerAudit(tx, { serverId: role.serverId, actorId: actor.userId, action: 'role.update', targetType: 'role', targetId: roleId, targetLabel: updates.name ?? role.name, changes });
    });
  }
  await changed(actor.snapshot.server.id);
  sendJson(reply, 200, { ok: true });
}

async function handleDelete(request: FastifyRequest<{ Params: RoleParams }>, reply: FastifyReply): Promise<void> {
  const roleId = String(request.params.roleId || '');
  const target = await requireRoleManager(request, reply, roleId);
  if (!target) return;
  const { role } = target;
  if (role.isDefault) return sendError(reply, 403, 'forbidden', 'O @everyone não pode ser apagado.');
  await db.transaction(async (tx) => {
    await lockServer(tx, role.serverId);
    const [gone] = await tx.delete(serverRoles).where(eq(serverRoles.id, roleId)).returning({ position: serverRoles.position });
    if (!gone) return;
    // close the gap: reordering sends positions 1..n, and a gap would make
    // every role above it look moved to whoever may only move roles below them
    await tx.update(serverRoles).set({ position: sql`${serverRoles.position} - 1` })
      .where(and(eq(serverRoles.serverId, role.serverId), gt(serverRoles.position, gone.position)));
    await recordServerAudit(tx, {
      serverId: role.serverId, actorId: target.actor.userId, action: 'role.delete', targetType: 'role', targetId: roleId, targetLabel: role.name,
      changes: deletedFields({ name: role.name, color: role.color, permissions: role.permissions }),
    });
  });
  await changed(target.actor.snapshot.server.id);
  sendJson(reply, 200, { ok: true });
}

/** `roleIds`: every role but @everyone, lowest first. Only roles below the
 * actor may move, and none may end up at or above the actor's own. */
async function handleOrder(request: FastifyRequest<{ Params: ServerParams }>, reply: FastifyReply): Promise<void> {
  const serverId = String(request.params.serverId || '');
  const actor = await requireServerMember(request, reply, serverId, PERMISSIONS.MANAGE_ROLES);
  if (!actor) return;
  const roles = actor.snapshot.roles.filter((r) => !r.isDefault);
  const body = jsonBody(request.body);
  const order = Array.isArray(body.roleIds) ? body.roleIds.filter((id): id is string => typeof id === 'string') : [];
  if (order.length !== roles.length || new Set(order).size !== roles.length || !order.every((id) => roles.some((r) => r.id === id))) {
    return sendError(reply, 400, 'invalid_request', 'Envie todos os cargos, do mais baixo ao mais alto.');
  }
  const top = highestRolePosition(actor.member, actor.snapshot.roles);
  for (const [index, id] of order.entries()) {
    const role = roles.find((r) => r.id === id)!;
    const position = index + 1;
    if (position !== role.position && (!canManageRole(actor.member, role, actor.snapshot.roles) || position >= top)) {
      return sendError(reply, 403, 'hierarchy', 'Você só pode reordenar cargos abaixo do seu.');
    }
  }
  const nameOf = (id: string) => roles.find((r) => r.id === id)!.name;
  const before = [...roles].sort((a, b) => a.position - b.position).map((r) => r.name);
  const after = order.map(nameOf);
  const applied = await db.transaction(async (tx) => {
    await lockServer(tx, serverId);
    // a role created or deleted since the snapshot would leave a duplicate or a gap
    const now = await tx.select({ id: serverRoles.id }).from(serverRoles).where(and(eq(serverRoles.serverId, serverId), eq(serverRoles.isDefault, false)));
    if (now.length !== order.length || !now.every((r) => order.includes(r.id))) return false;
    for (const [index, id] of order.entries()) await tx.update(serverRoles).set({ position: index + 1 }).where(eq(serverRoles.id, id));
    // lowest first, the way the request sends them
    if (before.join('\n') !== after.join('\n')) {
      await recordServerAudit(tx, { serverId, actorId: actor.userId, action: 'role.reorder', targetType: 'server', targetId: serverId, targetLabel: actor.snapshot.server.name, changes: [{ key: 'order', before, after }] });
    }
    return true;
  });
  await changed(serverId);
  if (!applied) return sendError(reply, 409, 'conflict', 'Os cargos mudaram enquanto você reordenava. Tente de novo.');
  sendJson(reply, 200, { ok: true });
}

/** Sets the member's roles to exactly `roleIds`. Every role added or taken
 * away must be below the actor, and the member too — except the actor
 * handing themself a role below their own. A role added may only carry
 * permissions the actor could grant: otherwise MANAGE_ROLES alone would reach
 * anything a lower role holds, ADMINISTRATOR included. */
async function handleSetMemberRoles(request: FastifyRequest<{ Params: MemberParams }>, reply: FastifyReply): Promise<void> {
  const serverId = String(request.params.serverId || '');
  const actor = await requireServerMember(request, reply, serverId, PERMISSIONS.MANAGE_ROLES);
  if (!actor) return;
  const userId = String(request.params.userId || '');
  const target = memberInput(actor.snapshot, userId);
  if (!target) return sendError(reply, 404, 'user_not_found', 'Essa pessoa não está no servidor.');
  if (userId !== actor.userId && !outranks(actor.member, target, actor.snapshot.roles)) return sendError(reply, 403, 'hierarchy', 'Essa pessoa está acima de você.');
  const body = jsonBody(request.body);
  const assignable = actor.snapshot.roles.filter((r) => !r.isDefault);
  const wanted = new Set((Array.isArray(body.roleIds) ? body.roleIds : []).filter((id): id is string => typeof id === 'string' && assignable.some((r) => r.id === id)));
  const current = new Set(target.roleIds);
  const touched = [...wanted].filter((id) => !current.has(id)).concat([...current].filter((id) => !wanted.has(id)));
  for (const id of touched) {
    if (!canManageRole(actor.member, assignable.find((r) => r.id === id)!, actor.snapshot.roles)) return sendError(reply, 403, 'hierarchy', 'Esse cargo está acima do seu.');
  }
  for (const id of wanted) {
    if (current.has(id)) continue;
    if ((assignable.find((r) => r.id === id)!.permissions & ~grantable(actor)) !== 0) {
      return sendError(reply, 403, 'hierarchy', 'Esse cargo dá permissões que você não tem.');
    }
  }
  const roleNames = (ids: Iterable<string>) => [...ids].map((id) => assignable.find((r) => r.id === id)?.name).filter((n): n is string => !!n).sort();
  await db.transaction(async (tx) => {
    const removed = [...current].filter((id) => !wanted.has(id));
    if (removed.length) await tx.delete(serverMemberRoles).where(and(eq(serverMemberRoles.userId, userId), inArray(serverMemberRoles.roleId, removed)));
    const added = [...wanted].filter((id) => !current.has(id));
    if (added.length) await tx.insert(serverMemberRoles).values(added.map((roleId) => ({ serverId, userId, roleId }))).onConflictDoNothing();
    if (touched.length) {
      await recordServerAudit(tx, { serverId, actorId: actor.userId, action: 'member.roles_update', targetType: 'user', targetId: userId, changes: [{ key: 'roles', before: roleNames(current), after: roleNames(wanted) }] });
    }
  });
  await changed(serverId);
  await broadcastToServerMembers(serverId, { t: 'server-member-updated', serverId, userId, roleIds: [...wanted] });
  sendJson(reply, 200, { ok: true });
}

export function registerRoleRoutes(fastify: FastifyInstance): void {
  fastify.post('/api/servers/:serverId/roles', handleCreate);
  fastify.put('/api/servers/:serverId/roles/order', handleOrder);
  fastify.patch('/api/roles/:roleId', handleUpdate);
  fastify.delete('/api/roles/:roleId', handleDelete);
  fastify.put('/api/servers/:serverId/members/:userId/roles', handleSetMemberRoles);
}
