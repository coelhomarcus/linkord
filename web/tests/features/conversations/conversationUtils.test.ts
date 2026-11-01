import { describe, expect, it } from 'vitest';
import type { Conversation, PublicUser } from '@/shared/types/protocol';
import { conversationDocumentTitle, conversationMatchesQuery, conversationTitle, unreadCountForTab } from '@/features/conversations/conversationUtils';
import { describeInviteOutcome } from '@/features/conversations/inviteOutcome';
import { dateGroupLabel } from '@/features/conversations/media/mediaRows';
import { useLanguageForTests } from '@tests/fixtures/i18nFixture';

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

describe('conversationDocumentTitle', () => {
  it('is the app name when no conversation is open', () => {
    expect(conversationDocumentTitle(undefined, 'me', users)).toBe('Linkord');
  });

  it('names a friend by handle', () => {
    expect(conversationDocumentTitle(conv('dm'), 'me', users)).toBe('Linkord | @bea');
  });

  it('falls back to the app name for a DM whose other user is not loaded', () => {
    expect(conversationDocumentTitle(conv('dm', { memberIds: ['me', 'u-ghost'] }), 'me', users)).toBe('Linkord');
  });

  it('names a group and a bot by title', () => {
    const group = conv('g', { type: 'group', title: 'Os Xerecas' });
    const bot = conv('b', { type: 'bot', title: 'Alertas' });
    expect(conversationDocumentTitle(group, 'me', users)).toBe('Linkord | Os Xerecas');
    expect(conversationDocumentTitle(bot, 'me', users)).toBe('Linkord | Alertas');
  });
});

describe('conversation text in English', () => {
  useLanguageForTests('en-US');

  it('falls back to English names for untitled conversations', () => {
    expect(conversationTitle(null, 'me', users)).toBe('Conversation');
    expect(conversationTitle(conv('g', { type: 'group' }), 'me', users)).toBe('Group');
    expect(conversationTitle(conv('b', { type: 'bot' }), 'me', users)).toBe('Bot');
    expect(conversationTitle(conv('dm', { memberIds: ['me'] }), 'me', users)).toBe('Direct conversation');
  });

  it('describes invitation outcomes and media date groups in English', () => {
    expect(describeInviteOutcome('already_member')).toBe('is already in the group');
    const now = new Date(2026, 10, 10, 15).getTime();
    expect(dateGroupLabel(now, now)).toBe('Today');
    expect(dateGroupLabel(new Date(2026, 9, 1).getTime(), now)).toBe('October 2026');
  });
});
