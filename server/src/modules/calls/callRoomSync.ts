import { participants, setCallLeftHook } from '../presence/participants.js';
import { callRoomsApi, conversationIdOfRoom, isLiveKitConfigured, removeFromCall } from '../../integrations/livekit/livekit.js';
import type { CallRoomsApi } from '../../integrations/livekit/livekit.js';
import { logger } from '../../lib/logger.js';

const log = logger.child({ component: 'calls' });

/** How often the rooms are checked. Short, because a LiveKit token cannot be recalled: whoever kept
 * one (or the refreshed one LiveKit hands a connected client) can rejoin after every removal, and
 * this sweep is what finds them again. */
const CALL_ROOM_SWEEP_MS = 15_000;
/** An identity met here after the server removed it is kicked on sight, for this long. Longer than
 * any token LiveKit refreshes for a connected client. */
const REMOVED_MEMORY_MS = 60 * 60 * 1000;

/** The server's own view of a call is the only one that counts: a LiveKit identity is a connection
 * id (`Participant.id`), and it belongs in a room only while that connection is in that call. A
 * ghost waiting out its reconnect grace still is. */
function isExpectedInCall(identity: string, conversationId: string): boolean {
  return participants.get(identity)?.callConversationId === conversationId;
}

const removedAt = new Map<string, number>();
const key = (conversationId: string, identity: string) => `${conversationId}:${identity}`;

function forgetOldRemovals(now: number): void {
  for (const [k, at] of removedAt) if (now - at > REMOVED_MEMORY_MS) removedAt.delete(k);
}

async function remove(conversationId: string, identity: string, api: Pick<CallRoomsApi, 'removeParticipant'>, reason: string): Promise<boolean> {
  // checked again right before the request: a quick leave-and-rejoin reuses the same identity
  if (isExpectedInCall(identity, conversationId)) return false;
  removedAt.set(key(conversationId, identity), Date.now());
  try {
    await removeFromCall(conversationId, identity, api);
    return true;
  } catch (err) {
    log.warn('failed to remove a connection from a call room', { conversationId, identity, reason, err: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

/** A connection left a call on the server (call-leave, a move to another call, a revoke, the end
 * of a DM call, its grace running out): its media connection goes too. */
export function closeCallMedia(identity: string, conversationId: string, api: Pick<CallRoomsApi, 'removeParticipant'> = callRoomsApi()): Promise<boolean> {
  return remove(conversationId, identity, api, 'left');
}

/** Identities seen once where the server does not expect them. A second sighting removes them,
 * which leaves room for a state change racing the listing. */
const suspects = new Set<string>();

/** Removes every identity connected to one of this deployment's rooms that the server does not
 * consider in that call: a client that ignored call-leave, or one that rejoined with a kept token.
 * One already removed by the server goes at once, any other on its second sighting. */
export async function sweepCallRooms(api: CallRoomsApi = callRoomsApi(), now = Date.now()): Promise<string[]> {
  forgetOldRemovals(now);
  const seen = new Set<string>();
  const removed: string[] = [];
  for (const room of await api.listRooms()) {
    const conversationId = conversationIdOfRoom(room.name);
    if (!conversationId) continue;
    let live: { identity: string }[];
    try {
      live = await api.listParticipants(room.name);
    } catch {
      continue; // the room closed between the two calls
    }
    for (const { identity } of live) {
      if (isExpectedInCall(identity, conversationId)) continue;
      const k = key(conversationId, identity);
      if (!removedAt.has(k) && !suspects.has(k)) {
        seen.add(k);
        continue;
      }
      if (await remove(conversationId, identity, api, 'sweep')) removed.push(k);
    }
  }
  suspects.clear();
  for (const k of seen) suspects.add(k);
  if (removed.length > 0) log.warn('removed connections the server does not have in those calls', { connections: removed.length });
  return removed;
}

/** For tests. */
export function resetCallRoomSync(): void {
  removedAt.clear();
  suspects.clear();
}

/** Wires media removal into every way a connection leaves a call and starts the sweep. Called
 * after restoreCalls: before it, every restored connection would look unexpected. */
export function startCallRoomSync(): NodeJS.Timeout | null {
  if (!isLiveKitConfigured()) return null;
  setCallLeftHook((p, conversationId) => { void closeCallMedia(p.id, conversationId); });
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    sweepCallRooms()
      .catch((err) => log.error('call room sweep failed', err))
      .finally(() => { running = false; });
  }, CALL_ROOM_SWEEP_MS);
  timer.unref();
  return timer;
}
