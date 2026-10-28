import type { Conversation, Participant, PublicUser } from '@/shared/types/protocol';

export type ConversationListTab = 'direct' | 'group' | 'bot';

export function conversationTitle(conversation: Conversation | null | undefined, meUserId: string | null, users: Map<string, PublicUser>): string {
  if (!conversation) return 'Conversa';
  if (conversation.type === 'group') return conversation.title || 'Grupo';
  if (conversation.type === 'bot') return conversation.title || 'Bot';
  const otherId = conversation.memberIds.find((id) => id !== meUserId) ?? conversation.memberIds[0];
  const other = otherId ? users.get(otherId) : undefined;
  return other?.displayName || other?.username || 'Conversa direta';
}

export function conversationInitials(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 'L';
  return words.slice(0, 2).map((word) => word[0]?.toUpperCase()).join('');
}

export function directUser(conversation: Conversation | null | undefined, meUserId: string | null, users: Map<string, PublicUser>): PublicUser | null {
  if (!conversation || conversation.type !== 'direct') return null;
  const otherId = conversation.memberIds.find((id) => id !== meUserId);
  return otherId ? users.get(otherId) ?? null : null;
}

export function groupMembers(conversation: Conversation | null | undefined, users: Map<string, PublicUser>): PublicUser[] {
  if (!conversation) return [];
  return conversation.memberIds
    .map((id) => users.get(id))
    .filter((user): user is PublicUser => !!user)
    .sort((a, b) => a.displayName.localeCompare(b.displayName) || a.username.localeCompare(b.username));
}

export function conversationMatchesQuery(
  conversation: Conversation,
  query: string,
  meUserId: string | null,
  users: Map<string, PublicUser>,
): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return conversationTitle(conversation, meUserId, users).toLowerCase().includes(normalized);
}

export function unreadCountForTab(
  conversations: Conversation[],
  unreadByConversation: Map<string, number>,
  tab: Conversation['type'],
): number {
  let total = 0;
  for (const conversation of conversations) {
    if (conversation.type !== tab) continue;
    total += unreadByConversation.get(conversation.id) ?? 0;
  }
  return total;
}

export function callParticipantIds(meParticipantId: string | null, participants: Map<string, Participant>, conversationId: string | null): string[] {
  if (!conversationId) return [];
  const ids: string[] = [];
  if (meParticipantId) ids.push(meParticipantId);
  for (const participant of participants.values()) {
    if (participant.callConversationId === conversationId) ids.push(participant.id);
  }
  return [...new Set(ids)];
}
