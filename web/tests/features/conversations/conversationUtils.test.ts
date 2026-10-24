import { describe, expect, it } from 'vitest';
import type { Conversation, PublicUser } from '@/shared/types/protocol';
import { conversationMatchesQuery, unreadCountForTab } from '@/features/conversations/conversationUtils';

const bea: PublicUser = {
  id: 'u-bea', username: 'bea', displayName: 'Bea', avatar: '', avatarColor: 'green',
  banner: '', bio: '', profileLinks: [], role: 'user',
};

const conv = (id: string, over: Partial<Conversation> = {}): Conversation => ({
  id, type: 'direct', title: '', avatar: '', createdBy: null, memberIds: ['me', 'u-bea'],
  lastMessageAt: null, createdAt: 1, updatedAt: 1, pinnedAt: null, myRole: 'member', ownerId: null, memberCount: 2, ...over,
});

const users = new Map([['u-bea', bea]]);

describe('conversationMatchesQuery', () => {
  it('empty or whitespace query matches every conversation', () => {
    const dm = conv('dm');
    expect(conversationMatchesQuery(dm, '', 'me', users)).toBe(true);
    expect(conversationMatchesQuery(dm, '   ', 'me', users)).toBe(true);
  });

  it('matches a DM by the other user display name, case-insensitive', () => {
    const dm = conv('dm');
    expect(conversationMatchesQuery(dm, 'bea', 'me', users)).toBe(true);
    expect(conversationMatchesQuery(dm, 'BEA', 'me', users)).toBe(true);
    expect(conversationMatchesQuery(dm, 'xerecas', 'me', users)).toBe(false);
  });

  it('matches a group by title, case-insensitive', () => {
    const group = conv('g', { type: 'group', title: 'os xerecas', createdBy: 'me', myRole: 'owner', ownerId: 'me' });
    expect(conversationMatchesQuery(group, 'Xerecas', 'me', users)).toBe(true);
    expect(conversationMatchesQuery(group, 'bea', 'me', users)).toBe(false);
  });
});

describe('unreadCountForTab', () => {
  it('sums unread only for the given tab type', () => {
    const dm = conv('dm');
    const otherDm = conv('dm-2', { memberIds: ['me', 'u-other'] });
    const group = conv('g', { type: 'group', title: 'os xerecas', createdBy: 'me', myRole: 'owner', ownerId: 'me' });
    const unread = new Map([['dm', 3], ['g', 7], ['dm-2', 2]]);

    expect(unreadCountForTab([dm, otherDm, group], unread, 'direct')).toBe(5);
    expect(unreadCountForTab([dm, otherDm, group], unread, 'group')).toBe(7);
  });

  it('treats a missing unread entry as zero', () => {
    const dm = conv('dm');
    const group = conv('g', { type: 'group', title: 'os xerecas', createdBy: 'me', myRole: 'owner', ownerId: 'me' });
    expect(unreadCountForTab([dm, group], new Map(), 'direct')).toBe(0);
    expect(unreadCountForTab([dm, group], new Map([['g', 4]]), 'direct')).toBe(0);
  });
});
