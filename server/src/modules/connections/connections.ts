import crypto from 'node:crypto';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { profileConnections, profileWallWidgets, users, type ProfileConnection } from '../../db/schema.js';
import type { ErrorCode } from '../../http/errors.js';
import { ConnectionFetchError } from '../../integrations/connectionHttp.js';
import { fetchSteam, parseSteamProfile } from '../../integrations/steam/steamWebApi.js';
import { twitch } from '../../integrations/twitch/twitch.js';
import { readActivityWidgets } from '../activity/activityWidgets.js';
import { configuredProviders, isExternalGameProvider, MAX_CONNECTIONS, parseConnection, SYNC_INTERVAL_MS } from './policy.js';
import {
  ACTIVITY_WIDGET_TYPES, hasActivityPeriod, isActivityWidget, WIDGET_TYPES,
  type ActivityPeriod, type ActivityWidgetType, type ConnectionSnapshot, type ConnectionWidgetType, type WallSelection, type WidgetData, type WidgetType,
} from './types.js';
import { parseGameLists, readGameLists, replaceGameLists } from '../games/gameLists.js';
import { GAME_LISTS, GAME_WIDGET_TYPES, gameListOf } from '../games/types.js';
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
import { withProxiedImages } from './widgetImages.js';
import { logger } from '../../lib/logger.js';

export class ConnectionMutationError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  constructor(status: number, code: ErrorCode) { super(code); this.status = status; this.code = code; }
}
function connectionDto(row: ProfileConnection) {
  return { id: row.id, provider: row.provider, value: row.value, url: row.url, position: row.position, showOnProfile: row.showOnProfile,
    syncedAt: row.syncedAt?.toISOString() ?? null, syncError: row.syncError,
    status: row.provider === 'url' ? 'ready' : row.syncError ? 'error' : row.syncedAt ? 'ready' : 'pending' };
}
export async function listConnections(userId: string) {
  return db.select().from(profileConnections).where(eq(profileConnections.userId, userId)).orderBy(asc(profileConnections.position), asc(profileConnections.id));
}
export async function mutateConnection(userId: string, action: 'create' | 'edit' | 'delete', body: Record<string, unknown>, id?: string, verified?: { snapshot: ConnectionSnapshot; url: string }) {
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
      const parsed = parseConnection(provider, body.value);
      const input = parsed && { ...parsed, url: verified?.url ?? parsed.url };
      const syncedAt = verified ? new Date() : null;
      const sync = { snapshot: verified?.snapshot ?? null, syncedAt, syncError: null,
        nextSyncAt: syncedAt ? new Date(syncedAt.getTime() + SYNC_INTERVAL_MS) : new Date(),
        attempts: 0, leaseToken: null, leaseUntil: null };
      if (!input) throw new ConnectionMutationError(400, 'invalid_connection');
      if (action === 'create' && rows.length >= MAX_CONNECTIONS) throw new ConnectionMutationError(409, 'quota_exceeded');
      if (rows.some((row) => row.id !== id && (row.url.toLowerCase() === input.url.toLowerCase() || (input.provider !== 'url' && row.provider === input.provider)))) {
        throw new ConnectionMutationError(409, 'connection_exists');
      }
      if (current) {
        const visibility = typeof body.showOnProfile === 'boolean' ? { showOnProfile: body.showOnProfile } : {};
        if (current.value !== input.value || current.url !== input.url || verified) {
          await tx.update(profileConnections).set({ ...input, ...visibility, ...sync }).where(eq(profileConnections.id, current.id));
        } else if ('showOnProfile' in visibility) {
          await tx.update(profileConnections).set(visibility).where(eq(profileConnections.id, current.id));
        }
      } else {
        await tx.insert(profileConnections).values({ id: crypto.randomUUID(), userId, ...input, ...sync,
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
function publicLinks(rows: Pick<ProfileConnection, 'url' | 'showOnProfile'>[]): string[] {
  return rows.filter((row) => row.showOnProfile).map((row) => row.url);
}

/** A canonical Steam profile URL contains its ID, so the link alone loses the account name. */
export async function readPublicSteamConnection(userId: string, links: string[]) {
  if (!links.some((url) => url.startsWith('https://steamcommunity.com/profiles/'))) return undefined;
  const [row] = await db.select({ url: profileConnections.url, value: profileConnections.value, snapshot: profileConnections.snapshot })
    .from(profileConnections).where(and(eq(profileConnections.userId, userId), eq(profileConnections.provider, 'steam'), eq(profileConnections.showOnProfile, true)));
  if (!row || !links.includes(row.url)) return undefined;
  const input = parseSteamProfile(row.value);
  const handle = row.snapshot?.steamProfileHandle ?? (input?.id === null ? input.value : null);
  const profile = row.snapshot?.widgets['steam-profile'];
  const label = handle ? `@${handle}` : profile?.kind === 'steam-profile' ? profile.name : null;
  return label ? { url: row.url, label } : undefined;
}
// Old tabs can submit the retired calendar alongside all the current widgets.
const MAX_WALL_WIDGETS = 16;
const widgetKey = (connectionId: string | null, type: string) => `${connectionId ?? ''}:${type}`;

function supportedWidget(type: string, extended: boolean) {
  if (type === 'activity-calendar') return false;
  return extended || (!isActivityWidget(type) && !type.startsWith('steam-') && !type.startsWith('twitch-'));
}

export async function saveWall(userId: string, input: unknown, gameInput?: unknown, extended = true): Promise<void> {
  if (!Array.isArray(input) || input.length > MAX_WALL_WIDGETS) throw new ConnectionMutationError(400, 'invalid_wall');
  const lists = parseGameLists(gameInput);
  if (!lists) throw new ConnectionMutationError(400, 'invalid_wall');
  await db.transaction(async (tx) => {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
    const connections = (await tx.select().from(profileConnections).where(eq(profileConnections.userId, userId)))
      .filter((row) => row.showOnProfile && (extended || !isExternalGameProvider(row.provider)));
    const selected: WallSelection[] = [];
    const seen = new Set<string>();
    for (const value of input) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ConnectionMutationError(400, 'invalid_wall');
      const { connectionId, type, period } = value as Record<string, unknown>;
      if (extended && type === 'activity-calendar' && connectionId === null && period === undefined) continue;
      if (typeof type !== 'string' || !supportedWidget(type, extended)) throw new ConnectionMutationError(400, 'invalid_wall');
      let selection: WallSelection;
      if (gameListOf(type) || isActivityWidget(type)) {
        if (connectionId !== null && connectionId !== undefined) throw new ConnectionMutationError(400, 'invalid_wall');
        selection = { connectionId: null, type: type as WidgetType };
      } else {
        const row = connections.find((item) => item.id === connectionId);
        if (!row || !(WIDGET_TYPES[row.provider] as readonly string[]).includes(type)) throw new ConnectionMutationError(400, 'invalid_wall');
        selection = { connectionId: row.id, type: type as ConnectionWidgetType };
      }
      if (hasActivityPeriod(selection.type)) {
        if (period !== undefined && period !== 7 && period !== 30) throw new ConnectionMutationError(400, 'invalid_wall');
        selection.period = period ?? 30;
      } else if (period !== undefined) throw new ConnectionMutationError(400, 'invalid_wall');

      const key = widgetKey(selection.connectionId, type);
      if (seen.has(key)) throw new ConnectionMutationError(400, 'invalid_wall');
      seen.add(key);
      selected.push(selection);
    }
    // Preserve invisible rows in their slots, including when a tab from before these widgets saves.
    const rows = await tx.select().from(profileWallWidgets).where(eq(profileWallWidgets.userId, userId));
    const editable = rows.filter((row) => supportedWidget(row.type, extended)
      && (!row.connectionId || connections.some((connection) => connection.id === row.connectionId)));
    const ids = editable.map((row) => row.id);
    const preserved = new Set(rows.filter((row) => !ids.includes(row.id)).map((row) => row.position));
    if (ids.length) await tx.delete(profileWallWidgets).where(inArray(profileWallWidgets.id, ids));
    let position = 0;
    if (selected.length) await tx.insert(profileWallWidgets).values(selected.map((value) => {
      while (preserved.has(position)) position++;
      return { id: crypto.randomUUID(), userId, ...value, position: position++ };
    }));
    await replaceGameLists(tx, userId, lists);
  });
}

interface ConnectionView {
  connection: ReturnType<typeof connectionDto> | null;
  type: WidgetType;
  data: WidgetData | null;
  period?: ActivityPeriod;
  periods?: Record<ActivityPeriod, WidgetData | null>;
  hidden?: boolean;
}

export async function readWall(userId: string, owner = false, extended = true) {
  const selected = await db.select({ connection: profileConnections, widget: profileWallWidgets }).from(profileWallWidgets)
    .leftJoin(profileConnections, eq(profileWallWidgets.connectionId, profileConnections.id))
    .where(eq(profileWallWidgets.userId, userId)).orderBy(profileWallWidgets.position);
  const wanted = new Set<ActivityWidgetType>();
  if (extended) {
    if (owner) for (const type of ACTIVITY_WIDGET_TYPES) wanted.add(type);
    else for (const { widget } of selected) if (isActivityWidget(widget.type)) wanted.add(widget.type);
  }
  const [games, activity] = await Promise.all([readGameLists(db, userId), wanted.size ? readActivityWidgets(userId, wanted) : null]);
  const views = new Map<string, Promise<ConnectionView>>();
  function view(connection: ProfileConnection, type: ConnectionWidgetType) {
    const key = widgetKey(connection.id, type);
    const cached = views.get(key);
    if (cached) return cached;
    const result = (async (): Promise<ConnectionView> => {
      const snapshot = connection.snapshot;
      // An older worker can still write a snapshot during a rolling deploy.
      const canShow = connection.provider !== 'steam' || (snapshot?.steamVisibilityVerified === true && !connection.syncError);
      let data = canShow ? snapshot?.widgets[type] ?? null : null;
      if (data?.kind === 'twitch-live' && twitch.configured && selected.some(({ widget }) => widget.connectionId === connection.id && widget.type === type)) {
        const stream = await twitch.live(data.login).catch(() => undefined);
        if (stream !== undefined) data = { ...data, stream, status: stream ? 'live' : 'offline' };
      }
      return { connection: connectionDto(connection), type, data: data ? withProxiedImages(data) : null };
    })();
    views.set(key, result);
    return result;
  }
  const gameView = (type: WidgetType): ConnectionView => ({ connection: null, type, data: { kind: 'games', items: games[gameListOf(type)!] } });
  const activityView = (type: ActivityWidgetType, period: ActivityPeriod = 30): ConnectionView => ({
    connection: null, type, data: activity?.widget(type, period) ?? null,
    ...(!activity && { hidden: true }),
    ...(hasActivityPeriod(type) && { period }),
    ...(owner && hasActivityPeriod(type) && { periods: { 7: activity?.widget(type, 7) ?? null, 30: activity?.widget(type, 30) ?? null } }),
  });
  const widgets = (await Promise.all(selected.map(({ connection, widget }) => {
    if (!supportedWidget(widget.type, extended)) return null;
    if (connection) return connection.showOnProfile ? view(connection, widget.type as ConnectionWidgetType) : null;
    if (isActivityWidget(widget.type)) return activity || owner ? activityView(widget.type, widget.period === 7 ? 7 : 30) : null;
    return gameView(widget.type);
  }))).filter((widget): widget is ConnectionView => widget !== null);

  if (!owner) return { widgets };
  const providers = configuredProviders(extended);
  const available = [
    ...await Promise.all((await listConnections(userId)).filter((connection) => connection.showOnProfile && (extended || !isExternalGameProvider(connection.provider)))
      .flatMap((connection) => WIDGET_TYPES[connection.provider].map((type) => view(connection, type)))),
    ...GAME_LISTS.map((list) => gameView(GAME_WIDGET_TYPES[list])),
    ...[...wanted].map((type) => activityView(type)),
  ];
  return { widgets, available, providers };
}

const log = logger.child({ component: 'connections' });
async function session(request: FastifyRequest, reply: FastifyReply) {
  const result = await resolveSession(parseCookies(request.headers.cookie || '')[config.SESSION_COOKIE]);
  if (!result) sendError(reply, 401, 'unauthenticated', 'Não autenticado.');
  return result;
}
// Older tabs use the original catalog and can still edit it without replacing the new widgets.
const extendedCatalog = (request: FastifyRequest) => (request.query as { catalog?: string }).catalog === '2';

function connectionsResponse(rows: ReturnType<typeof connectionDto>[], extended: boolean) {
  return { connections: extended ? rows : rows.filter((row) => !isExternalGameProvider(row.provider)), providers: configuredProviders(extended) };
}

async function verifyConnection(userId: string, body: Record<string, unknown>, id?: string) {
  const current = id ? (await listConnections(userId)).find((row) => row.id === id) : null;
  const provider = current?.provider ?? body.provider;
  if (!isExternalGameProvider(provider) || body.value === undefined) return undefined;
  const parsed = parseConnection(provider, body.value);
  if (!parsed) throw new ConnectionMutationError(400, 'invalid_connection');
  if (!configuredProviders(true).includes(provider)) throw new ConnectionMutationError(503, 'connection_provider_unavailable');
  try {
    return provider === 'steam' ? await fetchSteam(parsed.url, config.STEAM_WEB_API_KEY) : await twitch.profile(parsed.value);
  } catch (error) {
    if (error instanceof ConnectionFetchError) {
      if (error.code === 'private' && provider === 'steam') throw new ConnectionMutationError(403, 'steam_profile_private');
      if (error.code === 'not_found') throw new ConnectionMutationError(404, 'connection_profile_missing');
      if (error.code === 'rate_limited') throw new ConnectionMutationError(429, 'rate_limited');
    }
    throw new ConnectionMutationError(503, 'connection_provider_unavailable');
  }
}

export function registerConnectionRoutes(app: FastifyInstance): void {
  app.get('/api/me/connections', async (request, reply) => {
    const me = await session(request, reply); if (!me) return;
    sendJson(reply, 200, connectionsResponse((await listConnections(me.userId)).map(connectionDto), extendedCatalog(request)));
  });
  const mutation = (action: 'create' | 'edit' | 'delete') => async (request: FastifyRequest<{ Params: { id?: string } }>, reply: FastifyReply) => {
    const me = await session(request, reply); if (!me) return;
    if (!allow(`connections:${me.userId}`, { windowMs: 60_000, max: 20 })) return sendError(reply, 429, 'rate_limited', 'Tente novamente em instantes.');
    const body = action === 'delete' ? {} : jsonBody(request.body);
    try {
      const verified = action === 'delete' ? undefined : await verifyConnection(me.userId, body, request.params.id);
      const connections = await mutateConnection(me.userId, action, body, request.params.id, verified);
      invalidateSessionsForUser(me.userId);
      publishProfileConnections(me.userId, publicLinks(connections));
      sendJson(reply, action === 'create' ? 201 : 200, connectionsResponse(connections, extendedCatalog(request)));
      if (action !== 'delete') void syncConnections().catch((err) => log.error('failed to start connection sync', err));
    } catch (error) {
      if (error instanceof ConnectionMutationError) return sendError(reply, error.status, error.code, error.code === 'steam_profile_private'
        ? 'O perfil Steam e os detalhes de jogos precisam estar públicos.' : 'Não foi possível alterar a conexão.');
      throw error;
    }
  };
  app.post('/api/me/connections', mutation('create'));
  app.patch('/api/me/connections/:id', mutation('edit'));
  app.delete('/api/me/connections/:id', mutation('delete'));
  app.get('/api/me/wall', async (request, reply) => {
    const me = await session(request, reply); if (me) sendJson(reply, 200, await readWall(me.userId, true, extendedCatalog(request)));
  });
  app.put('/api/me/wall', async (request, reply) => {
    const me = await session(request, reply); if (!me) return;
    if (!allow(`wall:${me.userId}`, { windowMs: 60_000, max: 20 })) return sendError(reply, 429, 'rate_limited', 'Tente novamente em instantes.');
    try {
      const body = jsonBody(request.body);
      await saveWall(me.userId, body.widgets, body.games, extendedCatalog(request));
      sendJson(reply, 200, await readWall(me.userId, true, extendedCatalog(request)));
    } catch (error) {
      if (error instanceof ConnectionMutationError) return sendError(reply, error.status, error.code, 'Seleção de widgets inválida.');
      throw error;
    }
  });
  app.get('/api/users/:userId/wall', async (request: FastifyRequest<{ Params: { userId: string } }>, reply) => {
    const me = await session(request, reply); if (!me) return;
    const target = await findById(request.params.userId);
    if (!target || !await canViewProfile(me.userId, me.role, target.id)) return sendError(reply, 404, 'user_not_found', 'Conta não encontrada.');
    sendJson(reply, 200, await readWall(target.id, false, extendedCatalog(request)));
  });
}
