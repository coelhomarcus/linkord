import { config } from '../../config/env.js';
import { getConversationForUser } from '../conversations/conversationsRepository.js';
import { PERMISSIONS } from '../servers/permissions.js';
import { participants, send } from '../presence/participants.js';
import { signPlaygroundToken } from './playgroundToken.js';
import type { AppSocket, HandlerTable } from '../../types.js';

// `playground-token`: a pass into the playground service for a connection in a
// playground call. The client asks for one to connect and again every so often
// while it plays (the service drops a connection whose pass runs out), so leaving
// the call or losing the channel ends its access within PLAYGROUND_TOKEN_TTL_MS.
// Answered with `token: null` when the service is off or the call is not this
// connection's playground; the client then stops asking.

export const PLAYGROUND_TOKEN_TTL_MS = 90_000;

interface PlaygroundSettings { url: string; secret: string }
let settings: PlaygroundSettings = { url: config.PLAYGROUND_URL, secret: config.PLAYGROUND_SECRET };

/** May this account connect to this call, and is it a playground? Read through the access gate. */
let isPlayground = async (conversationId: string, userId: string): Promise<boolean> => {
  const conversation = await getConversationForUser(conversationId, userId, PERMISSIONS.CONNECT);
  return conversation?.voiceMode === 'playground';
};

/** Tests choose the service's address and secret, and answer the access check themselves. */
export function setPlaygroundAccessForTests(next: PlaygroundSettings, check: (conversationId: string, userId: string) => Promise<boolean>): void {
  settings = next;
  isPlayground = check;
}

async function handlePlaygroundToken(socket: AppSocket, msg: { conversationId?: unknown }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  const conversationId = typeof msg.conversationId === 'string' ? msg.conversationId : '';
  if (!conversationId) return;
  let token: string | null = null;
  if (settings.url && p.callConversationId === conversationId && await isPlayground(conversationId, p.userId)
    // the call may have changed while the check ran
    && p.callConversationId === conversationId) {
    token = signPlaygroundToken({ pid: p.id, uid: p.userId, cid: conversationId, exp: Date.now() + PLAYGROUND_TOKEN_TTL_MS }, settings.secret);
  }
  send(socket, token ? { t: 'playground-token', conversationId, url: settings.url, token } : { t: 'playground-token', conversationId, token: null });
}

export const handlers: HandlerTable = {
  'playground-token': handlePlaygroundToken,
};
