import type { Conversation } from '@/shared/types/protocol';
import type { SearchScope } from './searchQuery';

/** Where a search from this conversation looks: its whole server, or the DM itself. */
export function searchScopeOf(conversation: Pick<Conversation, 'id' | 'serverId'> | null | undefined): SearchScope | null {
  if (!conversation) return null;
  return conversation.serverId ? { serverId: conversation.serverId } : { conversationId: conversation.id };
}

export function sameScope(a: SearchScope | null, b: SearchScope | null): boolean {
  if (!a || !b) return false;
  return ('serverId' in a && 'serverId' in b && a.serverId === b.serverId)
    || ('conversationId' in a && 'conversationId' in b && a.conversationId === b.conversationId);
}
