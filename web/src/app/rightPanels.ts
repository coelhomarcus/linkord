import type { Conversation } from '@/shared/types/protocol';

/** Whether the details (member list or DM profile) show, whatever their remembered
 * open flag says. Gated on what is actually on screen: the chat page, with a
 * conversation of the page's kind, and not covered by the call stage. Not on
 * "the last view picked" — that stays 'call' after a call ends, and gating on
 * it left the button doing nothing until another conversation was clicked. */
export function rightPanelsVisible(input: {
  detailsOpen: boolean;
  onChatPage: boolean;
  stageShown: boolean;
  conversationType: Conversation['type'] | null;
}): { details: boolean } {
  const chatShown = input.onChatPage && !input.stageShown && input.conversationType !== null;
  // the details are a text channel's member list, or the profile beside a DM
  const hasDetails = input.conversationType === 'text' || input.conversationType === 'direct';
  return { details: chatShown && hasDetails && input.detailsOpen };
}
