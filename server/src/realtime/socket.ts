import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { config } from '../config/env.js';
import {
  participants as participantsMap, join, send, sendSocketError, broadcastToKnownPeers, handleClose, ipOf,
  setCallConversationId, handlers as participantHandlers, announceParticipantJoined,
} from '../modules/presence/participants.js';
import { isInvisible } from '../modules/presence/userStatus.js';
import * as presenceStatus from '../modules/presence/presenceStatus.js';
import { applyPeerVisibility, buildPresenceSnapshot } from '../modules/presence/knownPeers.js';
import * as livekit from '../integrations/livekit/livekit.js';
import * as soundboard from '../modules/soundboard/soundboard.js';
import * as floodControl from './floodControl.js';
import * as chat from '../modules/messages/messages.js';
import * as conversations from '../modules/conversations/conversations.js';
import { listForUser, getConversationForUser, unreadCountsForUser } from '../modules/conversations/conversationsRepository.js';
import { listNotificationSettings } from '../modules/notifications/notificationSettings.js';
import { unreadMentionCounts } from '../modules/notifications/notificationsRepository.js';
import { listServersForUser } from '../modules/servers/serverSummaries.js';
import { PERMISSIONS } from '../modules/servers/permissions.js';
import { type ErrorCode } from '../http/errors.js';
import * as moderation from '../modules/moderation/moderation.js';
import * as streamPreview from '../modules/calls/streamPreview.js';
import * as dmCalls from '../modules/calls/dmCalls.js';
import { refusesImmediateJoin } from '../modules/calls/dmCallMachine.js';
import { notePublishRights, publishRightsFor } from '../modules/calls/callPermissions.js';
import { channelPermissions } from '../modules/servers/serverAccess.js';
import { parseCookies } from '../http/cookies.js';
import { resolveSession } from '../modules/auth/session.js';
import { isSocketOriginAllowed } from '../http/originGuard.js';
import { isClientCompatible, PROTOCOL_VERSION } from './protocolVersion.js';
import type { AppSocket, HandlerTable } from '../types.js';
import { logger } from '../lib/logger.js';

const log = logger.child({ component: 'socket' });

// {message type: handler(socket, msg)} combining what each feature exports
// — register a new feature's `handlers` here, no dispatch changes needed.
// 'join' is special-cased (see handleJoin) because welcome needs data from
// several features.
const handlers: HandlerTable = Object.assign(
  {},
  participantHandlers,
  presenceStatus.handlers,
  soundboard.handlers,
  chat.handlers,
  conversations.handlers,
  moderation.handlers,
  streamPreview.handlers,
  dmCalls.handlers,
);

interface JoinMessage {
  id?: string;
  token?: string;
  v?: unknown;
}

// Rate-limit events that write to the database or trigger work on another client. Search is
// capped because scripted clients can bypass the UI debounce; click-driven reads stay uncapped.
// Typing is already throttled by the composer and does not touch the database.
const ACTION_LIMITS: Record<string, { windowMs: number; max: number }> = {
  chat: { windowMs: 10_000, max: 10 },
  'chat-edit': { windowMs: 10_000, max: 10 },
  'chat-delete': { windowMs: 10_000, max: 10 },
  'chat-remove-attachment': { windowMs: 10_000, max: 10 },
  'chat-suppress-embed': { windowMs: 10_000, max: 10 },
  'chat-react': { windowMs: 10_000, max: 20 },
  'soundboard-play': { windowMs: 10_000, max: 6 },
  profile: { windowMs: 60_000, max: 10 },
  'message-search': { windowMs: 10_000, max: 20 },
  'direct-open': { windowMs: 10_000, max: 10 },
  'conversation-mark-read': { windowMs: 10_000, max: 30 },
  'conversation-mark-all-read': { windowMs: 10_000, max: 30 },
  'server-mark-all-read': { windowMs: 10_000, max: 10 },
  // hover-driven, and each one may wake a streamer's client to draw a frame
  'stream-preview-request': { windowMs: 10_000, max: 20 },
  'stream-preview-frame': { windowMs: 10_000, max: 10 },
  'call-move': { windowMs: 10_000, max: 10 },
  'dm-call-start': { windowMs: 30_000, max: 5 },
  'presence-set': { windowMs: 60_000, max: 20 },
  // a client reports a change of state, not every input; a tab flapping on the threshold stays under this
  'presence-activity': { windowMs: 60_000, max: 30 },
};

/** 'join' is the one special case in the dispatch: only participants.ts
 * creates/finds the participant, but the `welcome` reply also carries chat
 * history and the LiveKit token — data from other features. Lives here
 * (the composition root) so no feature depends on another. */
async function handleJoin(socket: AppSocket, msg: JoinMessage): Promise<void> {
  // before anything is looked up or sent: an outdated client gets nothing but the reason
  if (!isClientCompatible(msg.v)) {
    log.warn('join refused: outdated client', { version: msg.v ?? null, ip: socket.ip });
    sendSocketError(socket, 'client_outdated', 'Há uma versão nova do Linkord. Atualize a página.');
    setTimeout(() => { try { socket.disconnect(true); } catch { /* already gone */ } }, 100).unref();
    return;
  }
  // before the connection exists: nothing may announce it as "online" while it is meant to be invisible
  await presenceStatus.loadAccountStatus(socket.user.userId);
  const joined = join(socket, msg);
  if (!joined) {
    presenceStatus.releaseAccountStatusIfUnused(socket.user.userId);
    return;
  }
  const { participant: p, justCameOnline } = joined;
  await applyPeerVisibility(p);
  // LiveKit token is NOT minted here for merely being online. A voice channel
  // gets one from call-join. A DM gets one only after the other person accepts,
  // or here when this connection is resuming an active DM and no other tab holds it.
  const dmCall = dmCalls.peekDmCallWelcome(p);
  const [conversationList, serverList] = await Promise.all([listForUser(p.userId), listServersForUser(p.userId)]);
  const textChannelIds = serverList.flatMap((server) => server.channels.filter((c) => c.type === 'text').map((c) => c.id));
  send(socket, {
    t: 'welcome',
    id: p.id,
    token: p.token,
    userId: p.userId,
    name: p.name,
    displayName: p.displayName,
    avatar: p.avatar,
    avatarPoster: p.avatarPoster,
    avatarColor: p.avatarColor,
    banner: p.banner,
    bannerPoster: p.bannerPoster,
    bio: p.bio,
    profileLinks: p.profileLinks,
    role: p.role,
    maxParticipants: config.MAX_PARTICIPANTS,
    // participants / knownUsers / onlineUserIds are scoped to knownPeerIds
    // (an isolated account receives none of it) — the same snapshot is
    // re-sent as `presence-sync` when that set changes mid-connection.
    ...(await buildPresenceSnapshot(p)),
    conversations: conversationList,
    servers: serverList,
    unreadByConversation: await unreadCountsForUser(p.userId, [...conversationList.map((c) => c.id), ...textChannelIds]),
    // per server and channel/DM levels and mutes (protocol 19), kept current by `notification-settings`,
    // and the unread mentions a muted conversation still shows
    notificationSettings: await listNotificationSettings(p.userId),
    mentionsByConversation: await unreadMentionCounts(p.userId),
    // the largest file this server takes, so the composer refuses a bigger one before uploading it
    maxAttachmentBytes: config.MAX_ATTACHMENT_BYTES,
    // tabs from before accounts lost their storage quota (protocol 7) read this; nothing counts it any more
    storageUsage: { totalBytes: 0, totalFiles: 0, maxBytes: 0 },
    livekitUrl: config.LIVEKIT_URL,
    // lets a reconnecting client notice the server no longer has it in the call it is still connected to
    callConversationId: p.callConversationId,
    ...(dmCall ? { dmCall: dmCall.view } : {}),
    // lets a newer client use what this server supports (3: correlated,
    // idempotent chat sends) and fall back otherwise
    protocolVersion: PROTOCOL_VERSION,
  });
  announceParticipantJoined(p);
  // the status before `user-online`, so nobody sees "online" for an instant before "do not disturb"
  presenceStatus.syncPresence(p.userId);
  if (justCameOnline && !isInvisible(p.userId)) broadcastToKnownPeers(p.userId, { t: 'user-online', userId: p.userId });
  if (dmCall?.connect) await dmCalls.finishDmCallWelcome(p);
  log.info('joined', { participantId: p.id, username: p.name, ip: socket.ip });
}

/** Joins a voice channel: mints a LiveKit token for that room and sets
 * `p.callConversationId`. A DM is refused here; its token waits for an accept. */
export async function handleCallJoin(socket: AppSocket, msg: { conversationId?: string }): Promise<void> {
  const p = participantsMap.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  const conversationId = String(msg.conversationId || '');
  if (!conversationId) return;
  const conversation = await getConversationForUser(conversationId, p.userId, PERMISSIONS.CONNECT);
  if (!conversation) {
    sendSocketError(socket, 'call-not-allowed', 'Você não tem acesso a essa conversa.');
    return;
  }
  if (conversation.type === 'text') {
    sendSocketError(socket, 'call-not-allowed', 'Chamadas acontecem nos canais de voz.');
    return;
  }
  // A DM token only leaves the server after the callee accepts. call-join
  // stays the immediate path for voice channels.
  if (refusesImmediateJoin(conversation.type)) {
    sendSocketError(socket, 'call-not-allowed', 'Chamadas privadas começam com um toque. Espere a outra pessoa atender.');
    return;
  }
  // only voice channels get here, and they always belong to a server
  const rights = publishRightsFor(conversation.serverId ? await channelPermissions(conversation.serverId, conversationId, p.userId) : 0);
  let livekitToken: string;
  try {
    livekitToken = await livekit.createToken(p, livekit.roomNameFor(conversationId), rights);
  } catch (err) {
    log.warn('failed to generate LiveKit token', { participantId: p.id, err: err instanceof Error ? err.message : String(err) });
    sendSocketError(socket, 'livekit-unavailable', 'Vídeo/voz indisponível no momento.');
    return;
  }
  setCallConversationId(p, conversationId);
  notePublishRights(p, conversationId, rights);
  send(socket, { t: 'call-token', conversationId, livekitUrl: config.LIVEKIT_URL, livekitToken });
}

function handleCallLeave(socket: AppSocket): void {
  const p = participantsMap.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  const conversationId = p.callConversationId;
  setCallConversationId(p, null);
  if (conversationId) dmCalls.leaveActiveDmCall(p.userId, conversationId);
}

/** Runs a handler (sync or async) isolated from errors — otherwise an
 * exception or rejected promise from any feature's handler kills the whole
 * process (Node exits on unhandledRejection by default), disconnecting the
 * entire room over one participant's one bad message. */
function safeHandle(eventName: string, socket: AppSocket, payload: unknown, handler: (socket: AppSocket, payload: unknown) => unknown): void {
  try {
    const result = handler(socket, payload);
    if (result && typeof (result as Promise<unknown>).catch === 'function') {
      (result as Promise<unknown>).catch((err: unknown) => {
        log.error('error in socket handler', err, { event: eventName, participantId: socket.participantId });
      });
    }
  } catch (err) {
    log.error('error in socket handler', err, { event: eventName, participantId: socket.participantId });
  }
}

export function createWsServer(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    path: '/ws',
    transports: ['polling', 'websocket'],
    maxHttpBufferSize: config.MAX_MSG_BYTES,
  });

  // no anonymous socket ever exists: the handshake carries the cookie, so
  // the session is resolved BEFORE 'connection' fires. A rejection here
  // stops automatic reconnection; the client refreshes auth only for an
  // expired session and retries transient auth failures separately.
  io.use(async (socket: Socket, next) => {
    if (!isSocketOriginAllowed(socket.handshake.headers)) {
      log.warn('socket handshake from a disallowed origin', { origin: socket.handshake.headers.origin ?? null });
      return next(Object.assign(new Error('Origem não permitida.'), { data: { code: 'forbidden_origin' satisfies ErrorCode } }));
    }
    try {
      const cookies = parseCookies(socket.handshake.headers.cookie || '');
      const sess = await resolveSession(cookies[config.SESSION_COOKIE]);
      if (!sess) return next(Object.assign(new Error('Sessão inválida ou expirada.'), { data: { code: 'unauthorized' satisfies ErrorCode } }));
      (socket as AppSocket).user = sess;
      next();
    } catch {
      next(Object.assign(new Error('Erro de autenticação.'), { data: { code: 'auth_error' satisfies ErrorCode } }));
    }
  });

  io.on('connection', (rawSocket: Socket) => {
    const socket = rawSocket as AppSocket;
    socket.participantId = null;
    socket.ip = ipOf(socket);

    socket.onAny((eventName: string, payload: unknown) => {
      if (eventName === 'join') return safeHandle('join', socket, payload || {}, (s, p) => handleJoin(s, (p || {}) as JoinMessage));
      if (eventName === 'ping') return safeHandle('ping', socket, payload || {}, (s) => send(s, { t: 'pong' }));
      if (eventName === 'call-join') {
        return safeHandle(eventName, socket, payload || {}, (s, m) => handleCallJoin(s, (m || {}) as { conversationId?: string }));
      }
      if (eventName === 'call-leave') return safeHandle(eventName, socket, payload || {}, (s) => handleCallLeave(s));

      const handler = handlers[eventName];
      if (!handler) return;

      const rule = ACTION_LIMITS[eventName];
      if (rule) {
        const userId = participantsMap.get(socket.participantId ?? '')?.userId;
        // no participant yet (never joined) — the handler's own `p.socket
        // !== socket` guard already no-ops it, nothing to rate-limit.
        if (userId && !floodControl.allow(`${eventName}:${userId}`, rule)) {
          log.warn('socket action rate limited', { event: eventName, userId });
          const message = 'Você está enviando rápido demais. Espere um pouco.';
          if (chat.rejectCorrelated(eventName, socket, payload, 'rate_limited', message)) return;
          sendSocketError(socket, 'rate_limited', message);
          return;
        }
      }
      safeHandle(eventName, socket, payload || {}, handler);
    });

    socket.on('disconnect', (reason) => {
      log.debug('disconnected', { participantId: socket.participantId, reason });
      handleClose(socket);
    });
  });

  return io;
}
