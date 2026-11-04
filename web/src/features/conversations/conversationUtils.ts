import type { Conversation, Participant, PublicUser } from '@/shared/types/protocol';
import { i18n } from '@/shared/i18n/init';

export function conversationTitle(conversation: Conversation | null | undefined, meUserId: string | null, users: Map<string, PublicUser>): string {
  if (!conversation) return i18n.t('conversations:fallback.conversation');
  if (conversation.type !== 'direct') return conversation.title;
  const otherId = conversation.memberIds.find((id) => id !== meUserId) ?? conversation.memberIds[0];
  const other = otherId ? users.get(otherId) : undefined;
  return other?.displayName || other?.username || i18n.t('conversations:fallback.direct');
}

export const APP_TITLE = 'Linkord';

/** The browser tab title for the conversation on screen: a friend by
 * handle, a channel as `#name | Server`. With none open it is just the app name. */
export function conversationDocumentTitle(conversation: Conversation | null | undefined, meUserId: string | null, users: Map<string, PublicUser>, serverName?: string): string {
  if (!conversation) return APP_TITLE;
  if (conversation.type === 'direct') {
    const other = directUser(conversation, meUserId, users);
    const label = other?.username ? `@${other.username}` : other?.displayName;
    return label ? `${APP_TITLE} | ${label}` : APP_TITLE;
  }
  const channel = conversation.type === 'text' ? `#${conversation.title}` : conversation.title;
  return serverName ? `${APP_TITLE} | ${channel} | ${serverName}` : `${APP_TITLE} | ${channel}`;
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

export function callParticipantIds(meParticipantId: string | null, participants: Map<string, Participant>, conversationId: string | null): string[] {
  if (!conversationId) return [];
  const ids: string[] = [];
  if (meParticipantId) ids.push(meParticipantId);
  for (const participant of participants.values()) {
    if (participant.callConversationId === conversationId) ids.push(participant.id);
  }
  return [...new Set(ids)];
}
