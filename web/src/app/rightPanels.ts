import type { Conversation } from '@/shared/types/protocol';

/** Whether the details and media panels show, whatever their remembered
 * open flags say. Gated on what is actually on screen: the chat page, with a
 * conversation of the page's kind, and not covered by the call stage. Not on
 * "the last view picked" — that stays 'call' after a call ends, and gating on
 * it left both buttons doing nothing until another conversation was clicked. */
export function rightPanelsVisible(input: {
  detailsOpen: boolean;
  mediaOpen: boolean;
  onChatPage: boolean;
  stageShown: boolean;
  conversationType: Conversation['type'] | null;
}): { details: boolean; media: boolean } {
  const chatShown = input.onChatPage && !input.stageShown && input.conversationType !== null;
  const hasDetails = input.conversationType === 'group' || input.conversationType === 'bot';
  return { details: chatShown && hasDetails && input.detailsOpen, media: chatShown && input.mediaOpen };
}
