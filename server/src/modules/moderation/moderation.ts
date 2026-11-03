import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { conversations } from '../../db/schema.js';
import { participants, sendSocketError, setCallConversationId } from '../presence/participants.js';
import * as livekit from '../../integrations/livekit/livekit.js';
import { hasPermission, outranks, PERMISSIONS } from '../servers/permissions.js';
import { channelPermissionsIn, loadServerSnapshot, memberInput } from '../servers/serverAccess.js';
import { isActiveAdmin } from '../admin/adminAuth.js';
import { recordAudit } from '../admin/auditLog.js';
import { ERROR_CODES } from '../../http/errors.js';
import type { AppSocket, HandlerTable } from '../../types.js';
import { logger } from '../../lib/logger.js';

const log = logger.child({ component: 'audit' });

// Disconnecting someone from a voice channel (a member with MOVE_MEMBERS
// there who outranks them, or an instance admin). Account deletion,
// suspension and the rest of the administrative actions live in
// modules/admin/ (HTTP, audited).

/** Kick-from-call authority: MOVE_MEMBERS in the voice channel and a higher
 * place in the role hierarchy than the target. Instance admins keep their
 * power as an audited moderation action. */
export function canKickFromCall(input: { actorIsAdmin: boolean; actorCanMove: boolean; actorOutranksTarget: boolean }): boolean {
  return input.actorIsAdmin || (input.actorCanMove && input.actorOutranksTarget);
}

/** Removes one CONNECTION (not account) from its current voice channel —
 * `participantId` here already identifies exactly which tab to kick if the
 * same account has more than one open. Not a ban: they can rejoin the
 * call immediately. Deliberately doesn't apply to 1:1 direct calls: a
 * global admin force-disconnecting one side of someone else's private
 * call isn't a moderation power this app grants — "leave call" already
 * covers the natural 1:1 case. */
async function handleCallKick(socket: AppSocket, msg: { participantId?: string }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;

  const targetId = String(msg.participantId || '');
  if (!targetId || targetId === p.id) return;

  const target = participants.get(targetId);
  if (!target || !target.callConversationId) return; // already left — race with another admin, or stale UI

  const callId = target.callConversationId;
  const [callConversation] = await db.select({ serverId: conversations.serverId }).from(conversations).where(eq(conversations.id, callId)).limit(1);
  if (!callConversation?.serverId) return;

  const snapshot = await loadServerSnapshot(callConversation.serverId);
  const actor = snapshot ? memberInput(snapshot, p.userId) : null;
  const targetMember = snapshot ? memberInput(snapshot, target.userId) : null;
  const actorIsAdmin = await isActiveAdmin(p.userId);
  const actorCanMove = !!snapshot && !!actor && hasPermission(channelPermissionsIn(snapshot, callId, p.userId), PERMISSIONS.MOVE_MEMBERS);
  const allowed = canKickFromCall({
    actorIsAdmin,
    actorCanMove,
    // someone no longer in the server is always below whoever moderates it
    actorOutranksTarget: !!snapshot && !!actor && (!targetMember || outranks(actor, targetMember, snapshot.roles)),
  });
  if (!allowed) {
    sendSocketError(socket, ERROR_CODES.forbidden, 'Você não tem permissão para remover essa pessoa da chamada.');
    return;
  }

  const roomName = livekit.roomNameFor(callId);
  try {
    await livekit.kickParticipant(roomName, target.id);
  } catch (err) {
    log.warn('failed to kick from the call', { participantId: target.id, err: err instanceof Error ? err.message : String(err) });
    sendSocketError(socket, 'livekit-unavailable', 'Não foi possível remover da chamada agora.');
    return;
  }
  // resets callConversationId + all self-reported media flags and broadcasts
  // participant-updated, so every OTHER connected client's UI (tiles) updates for free.
  setCallConversationId(target, null);

  // acting as an instance admin (not as the server's own moderator) is an audited moderation action
  if (actorIsAdmin && !actorCanMove) {
    await recordAudit({
      actor: { id: p.userId, username: p.name }, action: 'call.kick', targetType: 'user', targetId: target.userId, targetLabel: target.name,
      detail: { conversationId: callId },
    }).catch((err) => log.error('call.kick', err));
  }
}

export const handlers: HandlerTable = {
  'call-kick': handleCallKick,
};
