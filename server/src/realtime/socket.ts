import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { config } from '../config/env.js';
import {
  participants as participantsMap, join, send, sendSocketError, broadcastToKnownPeers, publicParticipant, handleClose, ipOf,
  setCallConversationId, handlers as participantHandlers,
} from '../modules/presence/participants.js';
import { applyPeerVisibility, buildPresenceSnapshot } from '../modules/presence/knownPeers.js';
import * as livekit from '../integrations/livekit/livekit.js';
import * as soundboard from '../modules/soundboard/soundboard.js';
import * as floodControl from './floodControl.js';
import * as chat from '../modules/messages/messages.js';
import * as conversations from '../modules/conversations/conversations.js';
import { listForUser, getConversationForUser, getDirectPeerId, unreadCountsForUser } from '../modules/conversations/conversationsRepository.js';
import { listServersForUser } from '../modules/servers/serverSummaries.js';
import { PERMISSIONS } from '../modules/servers/permissions.js';
import { canSendDirectMessage } from '../modules/friendships/friendshipsRepository.js';
import { ERROR_CODES, type ErrorCode } from '../http/errors.js';
import { getUserUsage } from '../modules/attachments/attachmentQuota.js';
import * as moderation from '../modules/moderation/moderation.js';
import * as streamPreview from '../modules/calls/streamPreview.js';
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
  soundboard.handlers,
  chat.handlers,
  conversations.handlers,
  moderation.handlers,
  streamPreview.handlers,
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
  'conversation-mark-read': { windowMs: 10_000, max: 30 },
  // hover-driven, and each one may wake a streamer's client to draw a frame
  'stream-preview-request': { windowMs: 10_000, max: 20 },
  'stream-preview-frame': { windowMs: 10_000, max: 10 },
  'call-move': { windowMs: 10_000, max: 10 },
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
  const joined = join(socket, msg);
  if (!joined) return;
  const { participant: p, justCameOnline } = joined;
  await applyPeerVisibility(p);
  // LiveKit token is NOT minted here anymore — just having the tab open/
  // logged in shouldn't open a real call session. That now only happens
  // in handleCallJoin, when someone joins a voice channel or a DM call.
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
    storageUsage: await getUserUsage(p.userId),
    livekitUrl: config.LIVEKIT_URL,
    // lets a newer client use what this server supports (3: correlated,
    // idempotent chat sends) and fall back otherwise
    protocolVersion: PROTOCOL_VERSION,
  });
  broadcastToKnownPeers(p.userId, { t: 'participant-joined', participant: publicParticipant(p) }, p.id);
  if (justCameOnline) broadcastToKnownPeers(p.userId, { t: 'user-online', userId: p.userId });
  log.info('joined', { participantId: p.id, username: p.name, ip: socket.ip });
}

/** Actually joins a call — a server's voice channel or a DM: mints a
 * LiveKit token for that conversation's room (roomNameFor) and sets
 * `p.callConversationId`. A voice channel takes CONNECT there. */
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
  // §4.3: "iniciar chamada privada" is explicitly in the restricted-contact
  // list — a private call token is just another way to reach someone who
  // isn't (or is no longer) a friend. No-ops for channels (getDirectPeerId
  // returns null there).
  const peerId = await getDirectPeerId(conversationId, p.userId);
  if (peerId && !(await canSendDirectMessage(p.userId, peerId))) {
    sendSocketError(socket, ERROR_CODES.relationshipRequired, 'Vocês precisam ser amigos pra iniciar essa chamada.');
    return;
  }
  let livekitToken: string;
  try {
    livekitToken = await livekit.createToken(p, livekit.roomNameFor(conversationId));
  } catch (err) {
    log.warn('failed to generate LiveKit token', { participantId: p.id, err: err instanceof Error ? err.message : String(err) });
    sendSocketError(socket, 'livekit-unavailable', 'Vídeo/voz indisponível no momento.');
    return;
  }
  setCallConversationId(p, conversationId);
  send(socket, { t: 'call-token', conversationId, livekitUrl: config.LIVEKIT_URL, livekitToken });
}

function handleCallLeave(socket: AppSocket): void {
  const p = participantsMap.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  setCallConversationId(p, null);
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
