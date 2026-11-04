import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { config } from '../../config/env.js';
import { db } from '../../db/client.js';
import { serverInvites, servers, users, type ServerInvite } from '../../db/schema.js';
import { sendJson, sendError, jsonBody } from '../../http/respond.js';
import * as floodControl from '../../realtime/floodControl.js';
import { countServerMemberships, exceedsLimit, limitMax } from '../limits/limits.js';
import { toSocialUser } from '../users/users.js';
import { hasPermission, PERMISSIONS } from './permissions.js';
import { serverPermissions } from './serverAccess.js';
import { addServerMember, countServerMembers, isBanned, isServerMember, lockServer } from './serversRepository.js';
import { announceNewMember } from './serverInvitationsRepository.js';
import { requireServerMember, requireSession } from './serverHttp.js';
import { logger } from '../../lib/logger.js';

const log = logger.child({ component: 'server-invites' });

// Invite links (`/invite/<code>`): anyone signed in who has the code joins,
// as long as it is still live (not revoked, not expired, uses left) and they
// aren't banned. The preview only tells what the server is called, its icon
// and how many are in it — never who, or what is said there.

type ServerParams = { serverId: string };
type CodeParams = { code: string };

// unambiguous characters only — read aloud or retyped from a screenshot
const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
const MAX_AGE_SECONDS = [0, 30 * 60, 60 * 60, 6 * 60 * 60, 12 * 60 * 60, 24 * 60 * 60, 7 * 24 * 60 * 60];
const MAX_USES = [0, 1, 5, 10, 25, 50, 100];

export function newInviteCode(): string {
  const bytes = crypto.randomBytes(8);
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

/** Whether a link still lets someone in at `now`. */
export function isInviteLive(invite: Pick<ServerInvite, 'revokedAt' | 'expiresAt' | 'maxUses' | 'uses'>, now = new Date()): boolean {
  if (invite.revokedAt) return false;
  if (invite.expiresAt && invite.expiresAt <= now) return false;
  return invite.maxUses === null || invite.uses < invite.maxUses;
}

const liveCondition = () => and(
  isNull(serverInvites.revokedAt),
  or(isNull(serverInvites.expiresAt), gt(serverInvites.expiresAt, new Date())),
  or(isNull(serverInvites.maxUses), sql`${serverInvites.uses} < ${serverInvites.maxUses}`),
);

function inviteView(invite: ServerInvite) {
  return {
    code: invite.code, serverId: invite.serverId, channelId: invite.channelId, createdBy: invite.createdBy,
    maxUses: invite.maxUses, uses: invite.uses,
    expiresAt: invite.expiresAt?.toISOString() ?? null, createdAt: invite.createdAt.toISOString(),
  };
}

async function handleCreate(request: FastifyRequest<{ Params: ServerParams }>, reply: FastifyReply): Promise<void> {
  const serverId = String(request.params.serverId || '');
  const actor = await requireServerMember(request, reply, serverId, PERMISSIONS.CREATE_INVITE);
  if (!actor) return;
  if (!floodControl.allow(`invite-create:${actor.userId}`, { windowMs: 60_000, max: 20 })) {
    return sendError(reply, 429, 'rate_limited', 'Você está criando convites rápido demais. Espere um pouco.');
  }
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(serverInvites).where(and(eq(serverInvites.serverId, serverId), liveCondition()));
  if (n >= config.MAX_INVITES_PER_SERVER) return sendError(reply, 409, 'quota_exceeded', 'O servidor já tem o máximo de convites ativos.');
  const body = request.body ? jsonBody(request.body) : {};
  const maxAge = MAX_AGE_SECONDS.includes(Number(body.maxAgeSeconds)) ? Number(body.maxAgeSeconds) : 7 * 24 * 60 * 60;
  const maxUses = MAX_USES.includes(Number(body.maxUses)) ? Number(body.maxUses) : 0;
  const channelId = typeof body.channelId === 'string' && actor.snapshot.channels.some((c) => c.id === body.channelId) ? body.channelId : null;
  const [invite] = await db.insert(serverInvites).values({
    code: newInviteCode(), serverId, channelId, createdBy: actor.userId,
    maxUses: maxUses || null, expiresAt: maxAge ? new Date(Date.now() + maxAge * 1000) : null,
  }).returning();
  sendJson(reply, 201, { invite: inviteView(invite!) });
}

async function handleList(request: FastifyRequest<{ Params: ServerParams }>, reply: FastifyReply): Promise<void> {
  const serverId = String(request.params.serverId || '');
  const actor = await requireServerMember(request, reply, serverId, PERMISSIONS.MANAGE_SERVER);
  if (!actor) return;
  const rows = await db.select({ invite: serverInvites, creator: users }).from(serverInvites)
    .leftJoin(users, eq(users.id, serverInvites.createdBy))
    .where(and(eq(serverInvites.serverId, serverId), liveCondition()))
    .orderBy(desc(serverInvites.createdAt));
  sendJson(reply, 200, { items: rows.map((r) => ({ ...inviteView(r.invite), creator: r.creator ? toSocialUser(r.creator) : null })) });
}

async function handleRevoke(request: FastifyRequest<{ Params: CodeParams }>, reply: FastifyReply): Promise<void> {
  const sess = await requireSession(request, reply);
  if (!sess) return;
  const [invite] = await db.select().from(serverInvites).where(eq(serverInvites.code, String(request.params.code || ''))).limit(1);
  if (!invite || invite.revokedAt) return sendError(reply, 404, 'invalid_invite', 'Convite não encontrado.');
  const manages = hasPermission(await serverPermissions(invite.serverId, sess.userId), PERMISSIONS.MANAGE_SERVER);
  if (invite.createdBy !== sess.userId && !manages) return sendError(reply, 404, 'invalid_invite', 'Convite não encontrado.');
  await db.update(serverInvites).set({ revokedAt: new Date() }).where(eq(serverInvites.code, invite.code));
  sendJson(reply, 200, { ok: true });
}

/** What the invite page and the chat card show. Signed-in accounts only: an
 * instance is not a public directory. */
async function handlePreview(request: FastifyRequest<{ Params: CodeParams }>, reply: FastifyReply): Promise<void> {
  const sess = await requireSession(request, reply);
  if (!sess) return;
  if (!floodControl.allow(`invite-preview:${sess.userId}`, { windowMs: 60_000, max: 60 })) {
    return sendError(reply, 429, 'rate_limited', 'Muitas consultas de convite. Espere um pouco.');
  }
  const [row] = await db.select({ invite: serverInvites, server: servers, inviter: users }).from(serverInvites)
    .innerJoin(servers, eq(servers.id, serverInvites.serverId))
    .leftJoin(users, eq(users.id, serverInvites.createdBy))
    .where(eq(serverInvites.code, String(request.params.code || ''))).limit(1);
  if (!row || row.server.status !== 'active' || !isInviteLive(row.invite)) return sendError(reply, 404, 'invalid_invite', 'Esse convite é inválido ou expirou.');
  sendJson(reply, 200, {
    code: row.invite.code,
    server: { id: row.server.id, name: row.server.name, icon: row.server.icon, memberCount: await countServerMembers(row.server.id) },
    inviter: row.inviter ? toSocialUser(row.inviter) : null,
    expiresAt: row.invite.expiresAt?.toISOString() ?? null,
    isMember: await isServerMember(row.server.id, sess.userId),
  });
}

/** Joins through the link. Counted as a use only when it actually adds the
 * member; someone already in just gets sent to the server. */
async function handleAccept(request: FastifyRequest<{ Params: CodeParams }>, reply: FastifyReply): Promise<void> {
  const sess = await requireSession(request, reply);
  if (!sess) return;
  if (!floodControl.allow(`invite-accept:${sess.userId}`, { windowMs: 60_000, max: 10 })) {
    return sendError(reply, 429, 'rate_limited', 'Muitas tentativas. Espere um pouco.');
  }
  const code = String(request.params.code || '');
  const [pre] = await db.select({ serverId: serverInvites.serverId }).from(serverInvites).where(eq(serverInvites.code, code)).limit(1);
  if (!pre) return sendError(reply, 404, 'invalid_invite', 'Esse convite é inválido ou expirou.');
  type Outcome = { code: 'joined' | 'already_member'; channelId: string | null } | { code: 'invalid' | 'banned' | 'server_full' | 'quota_exceeded' };
  const outcome = await db.transaction(async (tx): Promise<Outcome> => {
    await lockServer(tx, pre.serverId);
    const [invite] = await tx.select().from(serverInvites).where(eq(serverInvites.code, code)).for('update').limit(1);
    const [server] = await tx.select({ status: servers.status }).from(servers).where(eq(servers.id, pre.serverId)).limit(1);
    if (!invite || !server || server.status !== 'active' || !isInviteLive(invite)) return { code: 'invalid' };
    if (await isServerMember(pre.serverId, sess.userId, tx)) return { code: 'already_member', channelId: invite.channelId };
    if (await isBanned(pre.serverId, sess.userId, tx)) return { code: 'banned' };
    if ((await countServerMembers(pre.serverId, tx)) >= config.MAX_SERVER_MEMBERS) return { code: 'server_full' };
    if (exceedsLimit(await countServerMemberships(sess.userId, tx), limitMax('serverMemberships'))) return { code: 'quota_exceeded' };
    await addServerMember(tx, pre.serverId, sess.userId);
    await tx.update(serverInvites).set({ uses: sql`${serverInvites.uses} + 1` }).where(eq(serverInvites.code, code));
    return { code: 'joined', channelId: invite.channelId };
  });
  switch (outcome.code) {
    case 'invalid': return sendError(reply, 404, 'invalid_invite', 'Esse convite é inválido ou expirou.');
    case 'banned': return sendError(reply, 403, 'banned', 'Você foi banido desse servidor.');
    case 'server_full': return sendError(reply, 409, 'server_full', 'O servidor já está cheio.');
    case 'quota_exceeded': return sendError(reply, 409, 'quota_exceeded', 'Você já participa do máximo de servidores permitido.');
  }
  if (outcome.code === 'joined') {
    await announceNewMember(pre.serverId, sess.userId);
    log.info('joined through an invite link', { serverId: pre.serverId, userId: sess.userId });
  }
  sendJson(reply, 200, { serverId: pre.serverId, channelId: outcome.channelId, joined: outcome.code === 'joined' });
}

export function registerServerInviteRoutes(fastify: FastifyInstance): void {
  fastify.post('/api/servers/:serverId/invites', handleCreate);
  fastify.get('/api/servers/:serverId/invites', handleList);
  fastify.get('/api/invites/:code', handlePreview);
  fastify.post('/api/invites/:code/accept', handleAccept);
  fastify.delete('/api/invites/:code', handleRevoke);
}
