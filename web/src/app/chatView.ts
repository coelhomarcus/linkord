import type { ChatView } from '@/features/chat/useChatMessages';

/** What the user is looking at. Only 'chat' marks an arriving message as
 * read: the conversation's own chat, or the call stage with its side chat
 * actually open. The stage alone is 'call' — the messages are not on screen.
 * Another page, with the conversation still active behind it, is 'away'.
 * A remembered "chat open" flag does not count once the stage is gone. */
export function chatViewFor(input: {
  stageShown: boolean;
  callChatShown: boolean;
  visibleConversationId: string | null;
  activeConversationId: string | null;
}): ChatView {
  if (input.stageShown) return input.callChatShown ? 'chat' : 'call';
  return input.visibleConversationId && input.visibleConversationId === input.activeConversationId ? 'chat' : 'away';
}
