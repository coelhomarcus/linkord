import type { ChatView } from '@/features/chat/useChatMessages';

/** What the user is looking at. Only 'chat' marks an arriving message as
 * read: the conversation's own chat on screen. The call stage is 'call' —
 * no messages are on screen there. Another page, with the conversation still
 * active behind it, is 'away'. */
export function chatViewFor(input: {
  stageShown: boolean;
  visibleConversationId: string | null;
  activeConversationId: string | null;
}): ChatView {
  if (input.stageShown) return 'call';
  return input.visibleConversationId && input.visibleConversationId === input.activeConversationId ? 'chat' : 'away';
}
