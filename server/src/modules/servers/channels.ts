import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { config } from '../../config/env.js';
import { db } from '../../db/client.js';
import { channelPermissionOverwrites, conversations, serverCategories, users } from '../../db/schema.js';
import { sendJson, sendError, jsonBody } from '../../http/respond.js';
import { deleteForConversation } from '../attachments/attachmentCleanup.js';
import { revokeCallAccess } from '../calls/callAccess.js';
import { participants } from '../presence/participants.js';
import { ALL_PERMISSIONS, canManageRole, hasPermission, outranks, PERMISSIONS } from './permissions.js';
import { channelPermissionsIn, invalidateServer, memberInput, type ServerSnapshot } from './serverAccess.js';
import { sanitizeCategoryName, sanitizeChannelName, sanitizeTopic } from './serversRepository.js';
import { sendServerUpdateToMembers } from './serverSummaries.js';
import { requireServerMember, requireSession, type ServerActor } from './serverHttp.js';
import type { ChannelType } from './serverTemplate.js';
import { createdFields, diffFields, recordServerAudit } from './serverAuditLog.js';
import { logger } from '../../lib/logger.js';

const log = logger.child({ component: 'channels' });

// Channels, categories, their order and their permission overwrites. Every
// write here changes what members see, so each one ends the same way:
// invalidate the server's snapshot and send every member their new summary.

type ServerParams = { serverId: string };
type ChannelParams = { channelId: string };
type CategoryParams = { categoryId: string };
type OverwriteParams = { serverId: string; targetId: string };

async function changed(serverId: string): Promise<void> {
  invalidateServer(serverId);
  await sendServerUpdateToMembers(serverId);
}

/** The caller managing the server a channel belongs to. */
async function requireChannelManager(request: FastifyRequest, reply: FastifyReply, channelId: string): Promise<{ actor: ServerActor; channelId: string } | null> {
  const sess = await requireSession(request, reply);
  if (!sess) return null;
  const [channel] = await db.select({ serverId: conversations.serverId }).from(conversations).where(eq(conversations.id, channelId)).limit(1);
  if (!channel?.serverId) {
    sendError(reply, 404, 'not_found', 'Canal não encontrado.');
    return null;
  }
  const actor = await requireServerMember(request, reply, channel.serverId);
  if (!actor) return null;
  if (!hasPermission(channelPermissionsIn(actor.snapshot, channelId, actor.userId), PERMISSIONS.MANAGE_CHANNELS)) {
    sendError(reply, 403, 'forbidden', 'Você não tem permissão para gerenciar esse canal.');
    return null;
  }
  return { actor, channelId };
}

async function handleCreateChannel(request: FastifyRequest<{ Params: ServerParams }>, reply: FastifyReply): Promise<void> {
  const serverId = String(request.params.serverId || '');
  const actor = await requireServerMember(request, reply, serverId, PERMISSIONS.MANAGE_CHANNELS);
  if (!actor) return;
  const body = jsonBody(request.body);
  const type: ChannelType = body.type === 'voice' ? 'voice' : 'text';
  const name = sanitizeChannelName(body.name, type);
  if (!name) return sendError(reply, 400, 'invalid_name', 'Dê um nome ao canal.');
  if (actor.snapshot.channels.length >= config.MAX_CHANNELS_PER_SERVER) {
    return sendError(reply, 409, 'quota_exceeded', 'O servidor já tem o máximo de canais.');
  }
  const categoryId = typeof body.categoryId === 'string' && actor.snapshot.categories.some((c) => c.id === body.categoryId) ? body.categoryId : null;
  const position = actor.snapshot.channels.filter((c) => c.categoryId === categoryId).reduce((max, c) => Math.max(max, c.position + 1), 0);
  const id = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(conversations).values({ id, type, title: name, createdBy: actor.userId, serverId, categoryId, position, updatedAt: new Date() });
    await recordServerAudit(tx, { serverId, actorId: actor.userId, action: 'channel.create', targetType: 'channel', targetId: id, targetLabel: name, changes: createdFields({ name, type }) });
  });
  await changed(serverId);
  log.info('channel created', { serverId, channelId: id, type });
  sendJson(reply, 201, { channelId: id });
}

async function handleUpdateChannel(request: FastifyRequest<{ Params: ChannelParams }>, reply: FastifyReply): Promise<void> {
  const target = await requireChannelManager(request, reply, String(request.params.channelId || ''));
  if (!target) return;
  const { actor, channelId } = target;
  const channel = actor.snapshot.channels.find((c) => c.id === channelId)!;
  const body = jsonBody(request.body);
  const updates: { title?: string; topic?: string; permissionsSynced?: boolean; updatedAt: Date } = { updatedAt: new Date() };
  if (body.name !== undefined) {
    const name = sanitizeChannelName(body.name, channel.type);
    if (!name) return sendError(reply, 400, 'invalid_name', 'Dê um nome ao canal.');
    updates.title = name;
  }
  if (body.topic !== undefined) updates.topic = sanitizeTopic(body.topic);
  if (body.permissionsSynced === true) updates.permissionsSynced = true;
  const changes = diffFields({ name: channel.title, topic: channel.topic, permissionsSynced: channel.permissionsSynced },
    { name: updates.title, topic: updates.topic, permissionsSynced: updates.permissionsSynced }, ['name', 'topic', 'permissionsSynced']);
  await db.transaction(async (tx) => {
    await tx.update(conversations).set(updates).where(eq(conversations.id, channelId));
    // following the category again drops the channel's own rules
    if (updates.permissionsSynced) await tx.delete(channelPermissionOverwrites).where(eq(channelPermissionOverwrites.channelId, channelId));
    if (changes.length) {
      await recordServerAudit(tx, { serverId: actor.snapshot.server.id, actorId: actor.userId, action: 'channel.update', targetType: 'channel', targetId: channelId, targetLabel: updates.title ?? channel.title, changes });
    }
  });
  await changed(actor.snapshot.server.id);
  sendJson(reply, 200, { ok: true });
}

async function handleDeleteChannel(request: FastifyRequest<{ Params: ChannelParams }>, reply: FastifyReply): Promise<void> {
  const target = await requireChannelManager(request, reply, String(request.params.channelId || ''));
  if (!target) return;
  const { actor, channelId } = target;
  const channel = actor.snapshot.channels.find((c) => c.id === channelId)!;
  const inCall = [...participants.values()].filter((p) => p.callConversationId === channelId).map((p) => p.userId);
  await deleteForConversation(channelId);
  await db.transaction(async (tx) => {
    await tx.delete(conversations).where(eq(conversations.id, channelId));
    await recordServerAudit(tx, { serverId: actor.snapshot.server.id, actorId: actor.userId, action: 'channel.delete', targetType: 'channel', targetId: channelId, targetLabel: channel.title, extra: { type: channel.type } });
  });
  for (const userId of new Set(inCall)) void revokeCallAccess(userId, channelId);
  await changed(actor.snapshot.server.id);
  log.info('channel deleted', { serverId: actor.snapshot.server.id, channelId, actorId: actor.userId });
  sendJson(reply, 200, { ok: true });
}

async function handleCreateCategory(request: FastifyRequest<{ Params: ServerParams }>, reply: FastifyReply): Promise<void> {
  const serverId = String(request.params.serverId || '');
  const actor = await requireServerMember(request, reply, serverId, PERMISSIONS.MANAGE_CHANNELS);
  if (!actor) return;
  const name = sanitizeCategoryName(jsonBody(request.body).name);
  if (!name) return sendError(reply, 400, 'invalid_name', 'Dê um nome à categoria.');
  if (actor.snapshot.categories.length >= config.MAX_CHANNELS_PER_SERVER) {
    return sendError(reply, 409, 'quota_exceeded', 'O servidor já tem o máximo de categorias.');
  }
  const id = crypto.randomUUID();
  const position = actor.snapshot.categories.reduce((max, c) => Math.max(max, c.position + 1), 0);
  await db.transaction(async (tx) => {
    await tx.insert(serverCategories).values({ id, serverId, name, position });
    await recordServerAudit(tx, { serverId, actorId: actor.userId, action: 'category.create', targetType: 'category', targetId: id, targetLabel: name, changes: createdFields({ name }) });
  });
  await changed(serverId);
  sendJson(reply, 201, { categoryId: id });
}

async function requireCategoryManager(request: FastifyRequest, reply: FastifyReply, categoryId: string): Promise<ServerActor | null> {
  const sess = await requireSession(request, reply);
  if (!sess) return null;
  const [category] = await db.select({ serverId: serverCategories.serverId }).from(serverCategories).where(eq(serverCategories.id, categoryId)).limit(1);
  if (!category) {
    sendError(reply, 404, 'not_found', 'Categoria não encontrada.');
    return null;
  }
  return requireServerMember(request, reply, category.serverId, PERMISSIONS.MANAGE_CHANNELS);
}

async function handleUpdateCategory(request: FastifyRequest<{ Params: CategoryParams }>, reply: FastifyReply): Promise<void> {
  const categoryId = String(request.params.categoryId || '');
  const actor = await requireCategoryManager(request, reply, categoryId);
  if (!actor) return;
  const name = sanitizeCategoryName(jsonBody(request.body).name);
  if (!name) return sendError(reply, 400, 'invalid_name', 'Dê um nome à categoria.');
  const before = actor.snapshot.categories.find((c) => c.id === categoryId)!.name;
  await db.transaction(async (tx) => {
    await tx.update(serverCategories).set({ name }).where(eq(serverCategories.id, categoryId));
    if (name !== before) {
      await recordServerAudit(tx, { serverId: actor.snapshot.server.id, actorId: actor.userId, action: 'category.update', targetType: 'category', targetId: categoryId, targetLabel: name, changes: [{ key: 'name', before, after: name }] });
    }
  });
  await changed(actor.snapshot.server.id);
  sendJson(reply, 200, { ok: true });
}

/** The category goes; its channels stay, without a category, keeping the
 * rules they had through it as their own. */
async function handleDeleteCategory(request: FastifyRequest<{ Params: CategoryParams }>, reply: FastifyReply): Promise<void> {
  const categoryId = String(request.params.categoryId || '');
  const actor = await requireCategoryManager(request, reply, categoryId);
  if (!actor) return;
  await db.transaction(async (tx) => {
    const synced = await tx.select({ id: conversations.id }).from(conversations)
      .where(and(eq(conversations.categoryId, categoryId), eq(conversations.permissionsSynced, true)));
    const inherited = await tx.select().from(channelPermissionOverwrites).where(eq(channelPermissionOverwrites.categoryId, categoryId));
    for (const channel of synced) {
      if (inherited.length) {
        await tx.insert(channelPermissionOverwrites).values(inherited.map((o) => ({ ...o, id: crypto.randomUUID(), channelId: channel.id, categoryId: null })))
          .onConflictDoNothing();
      }
    }
    await tx.update(conversations).set({ permissionsSynced: false, categoryId: null }).where(eq(conversations.categoryId, categoryId));
    await tx.delete(serverCategories).where(eq(serverCategories.id, categoryId));
    const name = actor.snapshot.categories.find((c) => c.id === categoryId)?.name ?? '';
    await recordServerAudit(tx, { serverId: actor.snapshot.server.id, actorId: actor.userId, action: 'category.delete', targetType: 'category', targetId: categoryId, targetLabel: name });
  });
  await changed(actor.snapshot.server.id);
  sendJson(reply, 200, { ok: true });
}

/** The whole channel list's order in one go, as the drag-and-drop leaves
 * it: categories in order, and each channel's category and place. Ids that
 * don't belong to the server are ignored. */
async function handleLayout(request: FastifyRequest<{ Params: ServerParams }>, reply: FastifyReply): Promise<void> {
  const serverId = String(request.params.serverId || '');
  const actor = await requireServerMember(request, reply, serverId, PERMISSIONS.MANAGE_CHANNELS);
  if (!actor) return;
  const body = jsonBody(request.body);
  const categoryIds = new Set(actor.snapshot.categories.map((c) => c.id));
  const channelIds = new Set(actor.snapshot.channels.map((c) => c.id));
  const categories = (Array.isArray(body.categories) ? body.categories : []).filter((id): id is string => typeof id === 'string' && categoryIds.has(id));
  const channels = (Array.isArray(body.channels) ? body.channels : [])
    .filter((c): c is { id: string; categoryId: string | null } => !!c && typeof c === 'object' && channelIds.has((c as { id: unknown }).id as string))
    .map((c) => ({ id: c.id, categoryId: typeof c.categoryId === 'string' && categoryIds.has(c.categoryId) ? c.categoryId : null }));
  await db.transaction(async (tx) => {
    for (const [position, id] of categories.entries()) await tx.update(serverCategories).set({ position }).where(eq(serverCategories.id, id));
    const positions = new Map<string | null, number>();
    for (const channel of channels) {
      const position = positions.get(channel.categoryId) ?? 0;
      positions.set(channel.categoryId, position + 1);
      const current = actor.snapshot.channels.find((c) => c.id === channel.id)!;
      // moving a synced channel to another category makes it follow that one
      await tx.update(conversations).set({ position, categoryId: channel.categoryId, ...(current.categoryId !== channel.categoryId && !channel.categoryId ? { permissionsSynced: false } : {}) })
        .where(eq(conversations.id, channel.id));
    }
  });
  await changed(serverId);
  sendJson(reply, 200, { ok: true });
}

// ---- permission overwrites ---------------------------------------------------

function targetKind(snapshot: ServerSnapshot, targetId: string): 'channel' | 'category' | null {
  if (snapshot.channels.some((c) => c.id === targetId)) return 'channel';
  if (snapshot.categories.some((c) => c.id === targetId)) return 'category';
  return null;
}

/** What the actor may put in an overwrite: only bits they hold themselves
 * there (the owner and administrators hold all of them). */
function grantableBits(actor: ServerActor, targetId: string, kind: 'channel' | 'category'): number {
  if (hasPermission(actor.permissions, PERMISSIONS.ADMINISTRATOR)) return ALL_PERMISSIONS;
  return kind === 'channel' ? channelPermissionsIn(actor.snapshot, targetId, actor.userId) : actor.permissions;
}

async function handleListOverwrites(request: FastifyRequest<{ Params: OverwriteParams }>, reply: FastifyReply): Promise<void> {
  const serverId = String(request.params.serverId || '');
  const actor = await requireServerMember(request, reply, serverId, PERMISSIONS.MANAGE_ROLES);
  if (!actor) return;
  const targetId = String(request.params.targetId || '');
  const kind = targetKind(actor.snapshot, targetId);
  if (!kind) return sendError(reply, 404, 'not_found', 'Canal não encontrado.');
  const rows = await db.select().from(channelPermissionOverwrites)
    .where(kind === 'channel' ? eq(channelPermissionOverwrites.channelId, targetId) : eq(channelPermissionOverwrites.categoryId, targetId));
  sendJson(reply, 200, { items: rows.map((r) => ({ roleId: r.roleId, userId: r.userId, allow: r.allow, deny: r.deny })) });
}

/** Sets (or, with allow = deny = 0, removes) one role's or member's
 * overwrite. On a channel that follows its category, the category's rules
 * are copied onto it first and it stops following — Discord's behavior, so
 * editing one channel never silently changes its siblings. */
async function handleSetOverwrite(request: FastifyRequest<{ Params: OverwriteParams }>, reply: FastifyReply): Promise<void> {
  const serverId = String(request.params.serverId || '');
  const actor = await requireServerMember(request, reply, serverId, PERMISSIONS.MANAGE_ROLES);
  if (!actor) return;
  const targetId = String(request.params.targetId || '');
  const kind = targetKind(actor.snapshot, targetId);
  if (!kind) return sendError(reply, 404, 'not_found', 'Canal não encontrado.');
  const body = jsonBody(request.body);
  const roleId = typeof body.roleId === 'string' ? body.roleId : null;
  const userId = typeof body.userId === 'string' ? body.userId : null;
  if ((roleId === null) === (userId === null)) return sendError(reply, 400, 'invalid_request', 'Escolha um cargo ou um membro.');
  const allow = Number(body.allow) & ALL_PERMISSIONS;
  const deny = Number(body.deny) & ALL_PERMISSIONS & ~allow;
  if (roleId) {
    const role = actor.snapshot.roles.find((r) => r.id === roleId);
    if (!role) return sendError(reply, 404, 'not_found', 'Cargo não encontrado.');
    if (!role.isDefault && !canManageRole(actor.member, role, actor.snapshot.roles)) return sendError(reply, 403, 'hierarchy', 'Esse cargo está acima do seu.');
  } else {
    const subject = memberInput(actor.snapshot, userId!);
    if (!subject) return sendError(reply, 404, 'user_not_found', 'Essa pessoa não está no servidor.');
    // the same rule as a role: a member's own rule only from someone above them
    if (userId !== actor.userId && !outranks(actor.member, subject, actor.snapshot.roles)) return sendError(reply, 403, 'hierarchy', 'Essa pessoa está acima de você.');
  }
  const grantable = grantableBits(actor, targetId, kind);
  if (((allow | deny) & ~grantable) !== 0) return sendError(reply, 403, 'hierarchy', 'Você não pode mexer em permissões que você não tem.');

  // what applied to this role or member there before: a synced channel's rules are its category's
  const channel = kind === 'channel' ? actor.snapshot.channels.find((c) => c.id === targetId)! : null;
  const effectiveTarget = channel?.permissionsSynced && channel.categoryId ? channel.categoryId : targetId;
  const previous = (actor.snapshot.overwrites.get(effectiveTarget) ?? []).find((o) => (roleId ? o.roleId === roleId : o.userId === userId));
  const changes = diffFields({ allow: previous?.allow ?? 0, deny: previous?.deny ?? 0 }, { allow, deny }, ['allow', 'deny']);
  const targetLabel = channel ? channel.title : actor.snapshot.categories.find((c) => c.id === targetId)!.name;

  await db.transaction(async (tx) => {
    if (channel) {
      if (channel.permissionsSynced && channel.categoryId) {
        const inherited = await tx.select().from(channelPermissionOverwrites).where(eq(channelPermissionOverwrites.categoryId, channel.categoryId));
        if (inherited.length) {
          await tx.insert(channelPermissionOverwrites).values(inherited.map((o) => ({ ...o, id: crypto.randomUUID(), channelId: targetId, categoryId: null })))
            .onConflictDoNothing();
        }
      }
      await tx.update(conversations).set({ permissionsSynced: false }).where(eq(conversations.id, targetId));
    }
    const targetColumn = kind === 'channel' ? channelPermissionOverwrites.channelId : channelPermissionOverwrites.categoryId;
    const subject = roleId ? eq(channelPermissionOverwrites.roleId, roleId) : eq(channelPermissionOverwrites.userId, userId!);
    await tx.delete(channelPermissionOverwrites).where(and(eq(targetColumn, targetId), subject));
    if (allow || deny) {
      await tx.insert(channelPermissionOverwrites).values({
        id: crypto.randomUUID(), serverId,
        channelId: kind === 'channel' ? targetId : null, categoryId: kind === 'category' ? targetId : null,
        roleId, userId, allow, deny,
      });
    }
    if (changes.length) {
      const [subjectUser] = userId ? await tx.select({ username: users.username }).from(users).where(eq(users.id, userId)).limit(1) : [];
      await recordServerAudit(tx, {
        serverId, actorId: actor.userId, action: 'permissions.update', targetType: kind, targetId, targetLabel, changes,
        extra: roleId
          ? { subjectType: 'role', subjectId: roleId, subjectLabel: actor.snapshot.roles.find((r) => r.id === roleId)!.name }
          : { subjectType: 'user', subjectId: userId, subjectLabel: subjectUser?.username ?? '' },
      });
    }
  });
  await changed(serverId);
  sendJson(reply, 200, { ok: true });
}

export function registerChannelRoutes(fastify: FastifyInstance): void {
  fastify.post('/api/servers/:serverId/channels', handleCreateChannel);
  fastify.patch('/api/channels/:channelId', handleUpdateChannel);
  fastify.delete('/api/channels/:channelId', handleDeleteChannel);
  fastify.post('/api/servers/:serverId/categories', handleCreateCategory);
  fastify.patch('/api/categories/:categoryId', handleUpdateCategory);
  fastify.delete('/api/categories/:categoryId', handleDeleteCategory);
  fastify.put('/api/servers/:serverId/layout', handleLayout);
  fastify.get('/api/servers/:serverId/overwrites/:targetId', handleListOverwrites);
  fastify.put('/api/servers/:serverId/overwrites/:targetId', handleSetOverwrite);
}
