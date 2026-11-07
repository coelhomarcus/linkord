import type { Conversation } from '@/shared/types/protocol';

export interface RailDirect {
  conversationId: string;
  peerId: string;
  unread: number;
  inCall: boolean;
}

/** DMs that earn a circle on the rail: an unread one, or the active private call. A ring does not. */
export function railDirects(input: {
  conversations: Conversation[];
  myUserId: string | null;
  unreadByConversation: ReadonlyMap<string, number>;
  activeCallConversationId: string | null;
  dmCall: { phase: string; conversationId: string } | null;
}): RailDirect[] {
  const rows = input.conversations.flatMap((conversation) => {
    if (conversation.type !== 'direct') return [];
    const unread = input.unreadByConversation.get(conversation.id) ?? 0;
    const inCall = (input.dmCall?.phase === 'active' && input.dmCall.conversationId === conversation.id)
      || input.activeCallConversationId === conversation.id;
    if (unread <= 0 && !inCall) return [];
    const peerId = conversation.memberIds.find((id) => id !== input.myUserId);
    if (!peerId) return [];
    return [{ conversationId: conversation.id, peerId, unread, inCall, lastMessageAt: conversation.lastMessageAt ?? 0 }];
  });
  rows.sort((a, b) => Number(b.inCall) - Number(a.inCall) || b.lastMessageAt - a.lastMessageAt);
  return rows.map(({ conversationId, peerId, unread, inCall }) => ({ conversationId, peerId, unread, inCall }));
}
