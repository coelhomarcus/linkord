import type { Conversation } from '@/shared/types/protocol';
import { hasPermission, PERMISSIONS } from '@/features/servers/permissionBits';

/** Mirrors the server's canKickFromCall (modules/moderation/moderation.ts):
 * MOVE_MEMBERS in the voice channel. Never in a 1:1
 * call, and never on yourself. The hierarchy part (only someone below you)
 * is the server's call: this only decides whether to offer it. */
export function canKickFromTile(input: {
  isMe: boolean; conversation: Conversation | undefined; targetUserId: string | undefined;
}): boolean {
  const { isMe, conversation, targetUserId } = input;
  if (isMe || conversation?.type !== 'voice' || !targetUserId) return false;
  return hasPermission(conversation.permissions ?? 0, PERMISSIONS.MOVE_MEMBERS);
}
