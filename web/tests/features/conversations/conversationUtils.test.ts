import { describe, expect, it } from 'vitest';
import type { Conversation, PublicUser } from '@/shared/types/protocol';
import { conversationDocumentTitle, conversationMatchesQuery, conversationTitle } from '@/features/conversations/conversationUtils';
import { describeInviteOutcome } from '@/features/conversations/inviteOutcome';
import { dateGroupLabel } from '@/features/conversations/media/mediaRows';
import { useLanguageForTests } from '@tests/fixtures/i18nFixture';

const bea: PublicUser = {
  id: 'u-bea', username: 'bea', displayName: 'Bea', avatar: '', avatarColor: 'green',
  banner: '', bio: '', profileLinks: [], role: 'user',
};

const conv = (id: string, over: Partial<Conversation> = {}): Conversation => ({
  id, type: 'direct', title: '', memberIds: ['me', 'u-bea'], serverId: null,
  lastMessageAt: null, createdAt: 1, updatedAt: 1, pinnedAt: null, ...over,
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

  it('matches a channel by name, case-insensitive', () => {
    const group = conv('g', { type: 'text', title: 'os xerecas', serverId: 's', memberIds: [] });
    expect(conversationMatchesQuery(group, 'Xerecas', 'me', users)).toBe(true);
    expect(conversationMatchesQuery(group, 'bea', 'me', users)).toBe(false);
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

  it('names a channel with its server', () => {
    const text = conv('g', { type: 'text', title: 'geral', serverId: 's' });
    const voice = conv('v', { type: 'voice', title: 'Geral', serverId: 's' });
    expect(conversationDocumentTitle(text, 'me', users, 'Os Xerecas')).toBe('Linkord | #geral | Os Xerecas');
    expect(conversationDocumentTitle(voice, 'me', users)).toBe('Linkord | Geral');
  });
});

describe('conversation text in English', () => {
  useLanguageForTests('en-US');

  it('falls back to English names for untitled conversations', () => {
    expect(conversationTitle(null, 'me', users)).toBe('Conversation');
    expect(conversationTitle(conv('g', { type: 'text', title: 'general', serverId: 's' }), 'me', users)).toBe('general');
    expect(conversationTitle(conv('dm', { memberIds: ['me'] }), 'me', users)).toBe('Direct conversation');
  });

  it('describes invitation outcomes and media date groups in English', () => {
    expect(describeInviteOutcome('already_member')).toBe('is already in the server');
    const now = new Date(2026, 10, 10, 15).getTime();
    expect(dateGroupLabel(now, now)).toBe('Today');
    expect(dateGroupLabel(new Date(2026, 9, 1).getTime(), now)).toBe('October 2026');
  });
});
