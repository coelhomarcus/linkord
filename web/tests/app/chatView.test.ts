import { describe, expect, it } from 'vitest';
import { chatViewFor } from '@/app/chatView';

describe('chatViewFor', () => {
  it('reads the conversation while its own chat is on screen', () => {
    expect(chatViewFor({ stageShown: false, visibleConversationId: 'g', activeConversationId: 'g' })).toBe('chat');
  });

  it('does not read it from another page, or from a conversation that is not the one open', () => {
    expect(chatViewFor({ stageShown: false, visibleConversationId: null, activeConversationId: 'g' })).toBe('away');
    expect(chatViewFor({ stageShown: false, visibleConversationId: 'other', activeConversationId: 'g' })).toBe('away');
  });

  it('does not read messages that arrive while the call stage is on screen', () => {
    expect(chatViewFor({ stageShown: true, visibleConversationId: null, activeConversationId: 'g' })).toBe('call');
  });
});
