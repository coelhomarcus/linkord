import crypto from 'node:crypto';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { profileConnections, profileWallWidgets, users, type ProfileConnection } from '../../db/schema.js';
import type { ErrorCode } from '../../http/errors.js';
import { MAX_CONNECTIONS, parseConnection } from './policy.js';
import { WIDGET_TYPES, type WallSelection, type WidgetType } from './types.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../../config/env.js';
import { parseCookies } from '../../http/cookies.js';
import { jsonBody, sendError, sendJson } from '../../http/respond.js';
import { resolveSession, invalidateSessionsForUser } from '../auth/session.js';
import { publishProfileConnections } from '../presence/participants.js';
import { canViewProfile } from '../users/profileAccess.js';
import { findById } from '../users/users.js';
import { allow } from '../../realtime/floodControl.js';
import { syncConnections } from './syncWorker.js';
import { logger } from '../../lib/logger.js';

export class ConnectionMutationError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  constructor(status: number, code: ErrorCode) { super(code); this.status = status; this.code = code; }
}
export function connectionDto(row: ProfileConnection) {
  return { id: row.id, provider: row.provider, value: row.value, url: row.url, position: row.position, showOnProfile: row.showOnProfile,
    syncedAt: row.syncedAt?.toISOString() ?? null, syncError: row.syncError,
    status: row.provider === 'url' ? 'ready' : row.syncError ? 'error' : row.syncedAt ? 'ready' : 'pending' };
}
export async function listConnections(userId: string) {
  return db.select().from(profileConnections).where(eq(profileConnections.userId, userId)).orderBy(asc(profileConnections.position), asc(profileConnections.id));
}
export async function mutateConnection(userId: string, action: 'create' | 'edit' | 'delete', body: Record<string, unknown>, id?: string) {
  return db.transaction(async (tx) => {
    // The account lock serializes the count limit, projection, and wall edits across instances.
    const [owner] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
    if (!owner) throw new ConnectionMutationError(404, 'not_found');
    const rows = await tx.select().from(profileConnections).where(eq(profileConnections.userId, userId)).orderBy(profileConnections.position);
    const current = rows.find((row) => row.id === id);
    if (action !== 'create' && !current) throw new ConnectionMutationError(404, 'connection_not_found');
    if (action === 'delete') {
      await tx.delete(profileConnections).where(and(eq(profileConnections.id, id!), eq(profileConnections.userId, userId)));
    } else {
      const provider = current?.provider ?? body.provider;
      if (current && body.provider !== undefined && body.provider !== provider) throw new ConnectionMutationError(400, 'invalid_connection');
      if (body.showOnProfile !== undefined && typeof body.showOnProfile !== 'boolean') throw new ConnectionMutationError(400, 'invalid_connection');
      // an edit may only flip the visibility, with no new value to validate
      if (current && body.value === undefined) {
        if (body.showOnProfile === undefined) throw new ConnectionMutationError(400, 'invalid_connection');
        await tx.update(profileConnections).set({ showOnProfile: body.showOnProfile as boolean }).where(eq(profileConnections.id, current.id));
        return project(tx, userId);
      }
      const input = parseConnection(provider, body.value);
      if (!input) throw new ConnectionMutationError(400, 'invalid_connection');
      if (action === 'create' && rows.length >= MAX_CONNECTIONS) throw new ConnectionMutationError(409, 'quota_exceeded');
      if (rows.some((row) => row.id !== id && (row.url.toLowerCase() === input.url.toLowerCase() || (input.provider !== 'url' && row.provider === input.provider)))) {
        throw new ConnectionMutationError(409, 'connection_exists');
      }
      if (current) {
        const visibility = typeof body.showOnProfile === 'boolean' ? { showOnProfile: body.showOnProfile } : {};
        if (current.value !== input.value) {
          await tx.update(profileConnections).set({ ...input, ...visibility, snapshot: null, syncedAt: null, syncError: null,
            nextSyncAt: new Date(), attempts: 0, leaseToken: null, leaseUntil: null }).where(eq(profileConnections.id, current.id));
        } else if ('showOnProfile' in visibility) {
          await tx.update(profileConnections).set(visibility).where(eq(profileConnections.id, current.id));
        }
      } else {
        await tx.insert(profileConnections).values({ id: crypto.randomUUID(), userId, ...input,
          showOnProfile: typeof body.showOnProfile === 'boolean' ? body.showOnProfile : true,
          position: Math.max(-1, ...rows.map((row) => row.position)) + 1 });
      }
    }
    return project(tx, userId);
  });
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The connections after a change, and the public links rebuilt from the
 * ones shown on the profile. */
async function project(tx: Tx, userId: string) {
  const updated = await tx.select().from(profileConnections).where(eq(profileConnections.userId, userId)).orderBy(profileConnections.position);
  await tx.update(users).set({ profileLinks: publicLinks(updated), updatedAt: new Date() }).where(eq(users.id, userId));
  return updated.map(connectionDto);
}

/** What other people see of someone's connections: only the ones shown on the profile. */
export function publicLinks(rows: Pick<ProfileConnection, 'url' | 'showOnProfile'>[]): string[] {
  return rows.filter((row) => row.showOnProfile).map((row) => row.url);
}
export async function saveWall(userId: string, input: unknown): Promise<void> {
  if (!Array.isArray(input) || input.length > 6) throw new ConnectionMutationError(400, 'invalid_wall');
  await db.transaction(async (tx) => {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
    // a hidden connection's widgets are neither offered nor touched here, so
    // showing it again brings them back where they were
    const connections = (await tx.select().from(profileConnections).where(eq(profileConnections.userId, userId))).filter((row) => row.showOnProfile);
    const selected: WallSelection[] = [];
    const seen = new Set<string>();
    for (const value of input) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ConnectionMutationError(400, 'invalid_wall');
      const { connectionId, type } = value as Record<string, unknown>;
      const row = connections.find((item) => item.id === connectionId);
      if (!row || typeof type !== 'string' || !(WIDGET_TYPES[row.provider] as readonly string[]).includes(type)) throw new ConnectionMutationError(400, 'invalid_wall');
      const key = `${row.id}:${type}`;
      if (seen.has(key)) throw new ConnectionMutationError(400, 'invalid_wall');
      seen.add(key); selected.push({ connectionId: row.id, type: type as WidgetType });
    }
    if (connections.length) await tx.delete(profileWallWidgets).where(inArray(profileWallWidgets.connectionId, connections.map((row) => row.id)));
    if (selected.length) await tx.insert(profileWallWidgets).values(selected.map((value, position) => ({ id: crypto.randomUUID(), ...value, position })));
  });
}
export async function readWall(userId: string, owner = false) {
  const selected = await db.select({ connection: profileConnections, widget: profileWallWidgets }).from(profileWallWidgets)
    .innerJoin(profileConnections, eq(profileWallWidgets.connectionId, profileConnections.id))
    .where(eq(profileConnections.userId, userId)).orderBy(profileWallWidgets.position);
  const view = (connection: ProfileConnection, type: WidgetType) => ({
    connection: connectionDto(connection), type, data: connection.snapshot?.widgets[type] ?? null,
  });
  const widgets = selected.filter(({ connection }) => connection.showOnProfile).map(({ connection, widget }) => view(connection, widget.type));
  if (!owner) return { widgets };
  const available = (await listConnections(userId)).filter((connection) => connection.showOnProfile)
    .flatMap((connection) => WIDGET_TYPES[connection.provider].map((type) => view(connection, type)));
  return { widgets, available };
}

const log = logger.child({ component: 'connections' });
async function session(request: FastifyRequest, reply: FastifyReply) {
  const result = await resolveSession(parseCookies(request.headers.cookie || '')[config.SESSION_COOKIE]);
  if (!result) sendError(reply, 401, 'unauthenticated', 'Não autenticado.');
  return result;
}
export function registerConnectionRoutes(app: FastifyInstance): void {
  app.get('/api/me/connections', async (request, reply) => {
    const me = await session(request, reply); if (!me) return;
    sendJson(reply, 200, { connections: (await listConnections(me.userId)).map(connectionDto) });
  });
  const mutation = (action: 'create' | 'edit' | 'delete') => async (request: FastifyRequest<{ Params: { id?: string } }>, reply: FastifyReply) => {
    const me = await session(request, reply); if (!me) return;
    if (!allow(`connections:${me.userId}`, { windowMs: 60_000, max: 20 })) return sendError(reply, 429, 'rate_limited', 'Tente novamente em instantes.');
    const body = action === 'delete' ? {} : jsonBody(request.body);
    try {
      const connections = await mutateConnection(me.userId, action, body, request.params.id);
      invalidateSessionsForUser(me.userId);
      publishProfileConnections(me.userId, publicLinks(connections));
      sendJson(reply, action === 'create' ? 201 : 200, { connections });
      if (action !== 'delete') void syncConnections().catch((err) => log.error('failed to start connection sync', err));
    } catch (error) {
      if (error instanceof ConnectionMutationError) return sendError(reply, error.status, error.code, 'Não foi possível alterar a conexão.');
      throw error;
    }
  };
  app.post('/api/me/connections', mutation('create'));
  app.patch('/api/me/connections/:id', mutation('edit'));
  app.delete('/api/me/connections/:id', mutation('delete'));
  app.get('/api/me/wall', async (request, reply) => {
    const me = await session(request, reply); if (me) sendJson(reply, 200, await readWall(me.userId, true));
  });
  app.put('/api/me/wall', async (request, reply) => {
    const me = await session(request, reply); if (!me) return;
    if (!allow(`wall:${me.userId}`, { windowMs: 60_000, max: 20 })) return sendError(reply, 429, 'rate_limited', 'Tente novamente em instantes.');
    try {
      await saveWall(me.userId, jsonBody(request.body).widgets);
      sendJson(reply, 200, await readWall(me.userId, true));
    } catch (error) {
      if (error instanceof ConnectionMutationError) return sendError(reply, error.status, error.code, 'Seleção de widgets inválida.');
      throw error;
    }
  });
  app.get('/api/users/:userId/wall', async (request: FastifyRequest<{ Params: { userId: string } }>, reply) => {
    const me = await session(request, reply); if (!me) return;
    const target = await findById(request.params.userId);
    if (!target || !await canViewProfile(me.userId, me.role, target.id)) return sendError(reply, 404, 'user_not_found', 'Conta não encontrada.');
    sendJson(reply, 200, await readWall(target.id));
  });
}
