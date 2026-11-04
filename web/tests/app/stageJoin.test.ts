import { describe, expect, it } from 'vitest';
import { isJoiningStage } from '@/app/stageJoin';

describe('isJoiningStage', () => {
  it('is joining while the stage being viewed is the pending join', () => {
    expect(isJoiningStage({ stageConversationId: 'v', pendingConversationId: 'v', failedConversationId: null })).toBe(true);
  });

  it('is not joining when nothing is pending or another call is', () => {
    expect(isJoiningStage({ stageConversationId: 'v', pendingConversationId: null, failedConversationId: null })).toBe(false);
    expect(isJoiningStage({ stageConversationId: 'v', pendingConversationId: 'other', failedConversationId: null })).toBe(false);
    expect(isJoiningStage({ stageConversationId: null, pendingConversationId: 'v', failedConversationId: null })).toBe(false);
  });

  it('stops joining once the server refused that join, so the lobby can show why', () => {
    expect(isJoiningStage({ stageConversationId: 'v', pendingConversationId: 'v', failedConversationId: 'v' })).toBe(false);
  });

  it('ignores a refusal that belongs to another conversation', () => {
    expect(isJoiningStage({ stageConversationId: 'v', pendingConversationId: 'v', failedConversationId: 'other' })).toBe(true);
  });
});
