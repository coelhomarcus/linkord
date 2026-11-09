import { participants } from '../presence/participants.js';
import { hasPermission, PERMISSIONS } from '../servers/permissions.js';
import { channelPermissionsIn, loadServerSnapshot } from '../servers/serverAccess.js';
import { roomNameFor, updatePublishRights, type PublishRights } from '../../integrations/livekit/livekit.js';
import { revokeCallAccess } from './callAccess.js';
import { logger } from '../../lib/logger.js';
import type { Participant } from '../../types.js';

const log = logger.child({ component: 'calls' });

// What someone in a voice channel may do there follows their permissions
// while they are in it, not only when they joined: CONNECT (and seeing the
// channel at all) keeps them in, SPEAK lets them send their microphone,
// STREAM their camera and screen. LiveKit enforces the last two, so a
// change has to reach it, not just the client's buttons.

export function publishRightsFor(permissions: number): PublishRights {
  return { microphone: hasPermission(permissions, PERMISSIONS.SPEAK), video: hasPermission(permissions, PERMISSIONS.STREAM) };
}

// what the SFU was last told for each connection, so an unrelated change
// (a rename, a role colour) costs no LiveKit call
const applied = new WeakMap<Participant, string>();
const keyOf = (conversationId: string, rights: PublishRights) => `${conversationId}:${Number(rights.microphone)}${Number(rights.video)}`;

/** Records the rights a fresh token carried (realtime/socket.ts#handleCallJoin). */
export function notePublishRights(p: Participant, conversationId: string, rights: PublishRights): void {
  applied.set(p, keyOf(conversationId, rights));
}

/** Brings every call in the server's voice channels in line with the
 * permissions now in force: out of the call without CONNECT, and the
 * publish grant updated where SPEAK or STREAM changed. Run after anything
 * that may change permissions (roles, member roles, overwrites, channels,
 * ownership), once the snapshot was invalidated. Never throws. */
export async function enforceCallPermissions(serverId: string): Promise<void> {
  try {
    const snapshot = await loadServerSnapshot(serverId);
    if (!snapshot) return;
    const voice = new Set(snapshot.channels.filter((c) => c.type === 'voice').map((c) => c.id));
    const evicted = new Set<string>();
    for (const p of [...participants.values()]) {
      const channelId = p.callConversationId;
      if (!channelId || !voice.has(channelId)) continue;
      const permissions = channelPermissionsIn(snapshot, channelId, p.userId);
      if (!hasPermission(permissions, PERMISSIONS.CONNECT)) {
        const key = `${p.userId}:${channelId}`;
        if (!evicted.has(key)) {
          evicted.add(key);
          log.info('permission to stay in a call was taken away', { userId: p.userId, conversationId: channelId });
          void revokeCallAccess(p.userId, channelId);
        }
        continue;
      }
      const rights = publishRightsFor(permissions);
      const key = keyOf(channelId, rights);
      if (applied.get(p) === key) continue;
      applied.set(p, key);
      updatePublishRights(roomNameFor(channelId), p.id, rights).catch((err: unknown) => {
        // the participant may have left the room meanwhile; the next change tries again
        applied.delete(p);
        log.warn('failed to update what a participant may publish', { participantId: p.id, conversationId: channelId, err: err instanceof Error ? err.message : String(err) });
      });
    }
  } catch (err) {
    log.error('failed to enforce call permissions', err, { serverId });
  }
}
