import { describe, expect, it } from 'vitest';
import { chatViewFor } from '@/app/chatView';

const onStage = { stageShown: true, callChatShown: false, visibleConversationId: null, activeConversationId: 'g' };

describe('chatViewFor', () => {
  it('reads the conversation while its own chat is on screen', () => {
    expect(chatViewFor({ stageShown: false, callChatShown: false, visibleConversationId: 'g', activeConversationId: 'g' })).toBe('chat');
  });

  it('does not read it from another page, or from a conversation that is not the one open', () => {
    expect(chatViewFor({ stageShown: false, callChatShown: false, visibleConversationId: null, activeConversationId: 'g' })).toBe('away');
    expect(chatViewFor({ stageShown: false, callChatShown: true, visibleConversationId: null, activeConversationId: 'g' })).toBe('away');
    expect(chatViewFor({ stageShown: false, callChatShown: false, visibleConversationId: 'other', activeConversationId: 'g' })).toBe('away');
  });

  it('does not read messages that arrive on the call stage while its side chat is closed', () => {
    expect(chatViewFor(onStage)).toBe('call');
  });

  it('reads messages once the call side chat is open, the same as the conversation chat', () => {
    expect(chatViewFor({ ...onStage, callChatShown: true })).toBe('chat');
  });
});
