import type { Conversation, Participant } from '@/shared/types/protocol';

/** The call this account is in on another tab or device. */
export interface CallElsewhere {
  participantId: string;
  conversationId: string;
  kind: 'voice' | 'direct';
}

/** Another connection of this account in a call, or null. The server keeps an account in one call
 * at a time, so there is at most one; a tab that is in a call itself never has one. */
export function findCallElsewhere(
  participants: Iterable<Participant>,
  me: { id: string | null; userId: string | null },
  conversations: readonly Pick<Conversation, 'id' | 'type'>[],
): CallElsewhere | null {
  if (!me.userId) return null;
  for (const p of participants) {
    if (p.userId !== me.userId || p.id === me.id || !p.callConversationId) continue;
    const conversation = conversations.find((c) => c.id === p.callConversationId);
    return { participantId: p.id, conversationId: p.callConversationId, kind: conversation?.type === 'direct' ? 'direct' : 'voice' };
  }
  return null;
}
