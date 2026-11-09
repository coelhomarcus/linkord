import { participants, removeParticipant, send } from '../presence/participants.js';
import { revokeCallAccess } from '../calls/callAccess.js';

// The live side of ending a session. Deleting the row only stops the next request or handshake; a
// socket that is already connected would keep working (and its call media flowing) until it
// reconnects, so ending a session also cuts the connections opened with it.
//
// Only connected sockets are matched: a connection sitting in its reconnect grace has no socket to
// carry the session, and it cannot resume without one (the handshake is refused), so it lapses with
// the grace window.

/** Cuts the connections opened with these sessions, telling each tab first so it signs out instead of
 * showing "reconnecting". */
export function dropSessionConnections(tokenHashes: Iterable<string>): void {
  const ended = new Set(tokenHashes);
  if (ended.size === 0) return;
  for (const p of [...participants.values()]) {
    const socket = p.socket;
    if (!socket || !ended.has(socket.user.tokenHash)) continue;
    if (p.callConversationId) void revokeCallAccess(p.userId, p.callConversationId);
    send(socket, { t: 'session-ended' });
    removeParticipant(p);
    try { socket.disconnect(true); } catch { /* socket dying */ }
  }
}

/** The sessions behind a connected socket, so the sweep can count them as in use. */
export function liveSessionTokenHashes(): string[] {
  const hashes = new Set<string>();
  for (const p of participants.values()) if (p.socket) hashes.add(p.socket.user.tokenHash);
  return [...hashes];
}
