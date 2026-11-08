import { describe, expect, it } from 'vitest';
import type { Conversation } from '@/shared/types/protocol';
import { railDirects } from '@/features/servers/railDirects';

function dm(id: string, peer: string, lastMessageAt: number, type: Conversation['type'] = 'direct'): Conversation {
  return {
    id, type, title: type === 'direct' ? '' : 'Geral', memberIds: type === 'direct' ? ['me', peer] : [],
    serverId: type === 'direct' ? null : 's', lastMessageAt, createdAt: 0, updatedAt: 0,
  };
}

describe('railDirects', () => {
  it('lists an unread DM and the active call, with the call first', () => {
    const rows = railDirects({
      conversations: [dm('old', 'p1', 1), dm('new', 'p2', 5), dm('live', 'p3', 3), dm('voice', 'p4', 9, 'voice')],
      myUserId: 'me',
      unreadByConversation: new Map([['old', 2], ['new', 13]]),
      activeCallConversationId: 'live',
      dmCall: { phase: 'active', conversationId: 'live' },
    });
    expect(rows.map((row) => row.conversationId)).toEqual(['live', 'new', 'old']);
    expect(rows[0]).toMatchObject({ inCall: true, unread: 0, peerId: 'p3' });
  });

  it('ignores a ring and a voice channel', () => {
    const rows = railDirects({
      conversations: [dm('ring', 'p1', 4), dm('voice', 'p4', 9, 'voice')],
      myUserId: 'me',
      unreadByConversation: new Map(),
      activeCallConversationId: null,
      dmCall: { phase: 'incoming', conversationId: 'ring' },
    });
    expect(rows).toEqual([]);
  });
});
