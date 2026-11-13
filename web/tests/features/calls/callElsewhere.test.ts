import { describe, expect, it } from 'vitest';
import { findCallElsewhere } from '@/features/calls/callElsewhere';
import type { Participant } from '@/shared/types/protocol';

const me = { id: 'conn-me', userId: 'user-me' };
const conversations = [{ id: 'voice-1', type: 'voice' as const }, { id: 'dm-1', type: 'direct' as const }];
const connection = (over: Partial<Participant>) => ({ id: 'conn-x', userId: 'user-me', callConversationId: null, ...over }) as Participant;

describe('findCallElsewhere', () => {
  it('finds the voice channel another connection of the account is in', () => {
    const found = findCallElsewhere([connection({ id: 'conn-phone', callConversationId: 'voice-1' })], me, conversations);
    expect(found).toEqual({ participantId: 'conn-phone', conversationId: 'voice-1', kind: 'voice' });
  });

  it('tells a direct call apart', () => {
    expect(findCallElsewhere([connection({ callConversationId: 'dm-1' })], me, conversations)?.kind).toBe('direct');
  });

  it('ignores this connection, other accounts, and connections outside a call', () => {
    const participants = [
      connection({ id: 'conn-me', callConversationId: 'voice-1' }),
      connection({ id: 'conn-friend', userId: 'user-friend', callConversationId: 'voice-1' }),
      connection({ id: 'conn-idle' }),
    ];
    expect(findCallElsewhere(participants, me, conversations)).toBeNull();
  });

  it('knows nothing before the welcome says who this account is', () => {
    expect(findCallElsewhere([connection({ callConversationId: 'voice-1' })], { id: null, userId: null }, conversations)).toBeNull();
  });
});
