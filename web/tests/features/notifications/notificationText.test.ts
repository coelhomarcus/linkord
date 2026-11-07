import { describe, expect, it } from 'vitest';
import type { NotificationEntry } from '@/shared/api/api';
import { describeNotification, formatRelativeTime, notificationTarget } from '@/features/notifications/notificationText';
import { useLanguageForTests } from '@tests/fixtures/i18nFixture';

const actor = { id: 'u-ana', username: 'ana', displayName: 'Ana', avatar: '', avatarColor: 'blurple' };
const base: NotificationEntry = { id: 'n1', kind: 'friend_request', at: '2026-01-01T00:00:00.000Z', read: false, friendshipId: 'f1', invitationId: null, actor, server: null };

describe('notificationText', () => {
  it('describes each type', () => {
    expect(describeNotification(base)).toBe('Ana enviou uma solicitação de amizade');
    expect(describeNotification({ ...base, kind: 'friend_accepted' })).toBe('Ana aceitou sua solicitação de amizade');
    expect(describeNotification({ ...base, kind: 'server_invitation', server: { id: 'g', name: 'Squad', icon: '' } })).toBe('Ana convidou você para o servidor Squad');
  });

  it('tolerates a missing actor or server', () => {
    expect(describeNotification({ ...base, actor: null })).toBe('Alguém enviou uma solicitação de amizade');
    expect(describeNotification({ ...base, kind: 'server_invitation' })).toBe('Ana convidou você para um servidor');
  });

  it('a mention says who and where; a DM is just "uma conversa", and a webhook names the channel', () => {
    const mention = (type: 'direct' | 'text', name: string) => ({
      ...base, kind: 'mention' as const, friendshipId: null,
      mention: { messageId: 7, excerpt: '@eu olha', conversation: { id: 'c', type, name, serverId: type === 'text' ? 's' : null, serverName: 'Squad', serverIcon: '' } },
    });
    expect(describeNotification(mention('text', 'geral'))).toBe('Ana mencionou você em #geral · Squad');
    expect(describeNotification(mention('direct', ''))).toBe('Ana mencionou você em uma conversa');
    expect(describeNotification({ ...mention('text', 'avisos'), actor: null })).toBe('Você foi mencionado em #avisos · Squad');
  });

  it('each type leads to its own page', () => {
    expect(notificationTarget(base)).toBe('/app/friends?tab=pending#received');
    expect(notificationTarget({ ...base, kind: 'friend_accepted' })).toBe('/app/friends');
    expect(notificationTarget({ ...base, kind: 'server_invitation' })).toBe('/app/friends?tab=pending#invitations');
  });

  it('relative time', () => {
    const now = new Date('2026-01-01T12:00:00Z').getTime();
    expect(formatRelativeTime('2026-01-01T11:59:40Z', now)).toBe('agora');
    expect(formatRelativeTime('2026-01-01T11:30:00Z', now)).toBe('há 30 min');
    expect(formatRelativeTime('2026-01-01T09:00:00Z', now)).toBe('há 3 h');
    expect(formatRelativeTime('2025-12-30T12:00:00Z', now)).toBe('há 2 d');
    expect(formatRelativeTime('lixo', now)).toBe('');
  });
});

describe('English translations', () => {
  useLanguageForTests('en-US');

  it('describes friend notifications in English', () => {
    expect(describeNotification(base)).toBe('Ana sent you a friend request');
    expect(describeNotification({ ...base, kind: 'friend_accepted' })).toBe('Ana accepted your friend request');
  });

  it('formats relative notification time in English', () => {
    const now = new Date('2026-01-01T12:00:00Z').getTime();
    expect(formatRelativeTime('2026-01-01T11:00:00Z', now)).toBe('1 hr ago');
  });
});
