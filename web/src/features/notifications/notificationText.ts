import { i18n } from '@/shared/i18n/init';
import type { NotificationEntry } from '@/shared/api/api';
import { ROUTES, friendsSection, friendsView } from '@/shared/lib/routes';

type NotificationTextKey =
  | 'unknownActor'
  | 'unknownBot'
  | 'unknownGroup'
  | 'friendRequest'
  | 'friendAccepted'
  | 'groupInvitationNamed'
  | 'groupInvitationUnnamed'
  | 'mentionBot'
  | 'mentionDirect'
  | 'mentionGroup'
  | 'mentionBotConversation';

function text(key: NotificationTextKey, options?: Record<string, string>): string {
  return i18n.t(`notifications:text.${key}`, options);
}

export function describeNotification(entry: NotificationEntry): string {
  const who = entry.actor?.displayName ?? text('unknownActor');
  switch (entry.kind) {
    case 'friend_request': return text('friendRequest', { name: who });
    case 'friend_accepted': return text('friendAccepted', { name: who });
    case 'group_invitation': return entry.group
      ? text('groupInvitationNamed', { name: who, group: entry.group.title })
      : text('groupInvitationUnnamed', { name: who });
    case 'mention': {
      const conversation = entry.mention?.conversation;
      // A bot has no account behind it: the bot itself is who mentioned you.
      if (!entry.actor && conversation?.type === 'bot') {
        return text('mentionBot', { name: conversation.title || text('unknownBot') });
      }
      if (!conversation || conversation.type === 'direct') return text('mentionDirect', { name: who });
      if (conversation.type === 'bot') return text('mentionBotConversation', { name: who, bot: conversation.title || text('unknownBot') });
      return text('mentionGroup', { name: who, group: conversation.title || text('unknownGroup') });
    }
  }
}

export function notificationTarget(entry: NotificationEntry): string {
  switch (entry.kind) {
    case 'friend_request': return friendsSection('received');
    case 'friend_accepted': return ROUTES.friends;
    case 'group_invitation': return friendsView('invitations');
    // opened by jumping to the message itself (see NotificationBell), not by a route
    case 'mention': return ROUTES.conversations;
  }
}

export function formatUnread(count: number): string {
  return count > 9 ? '9+' : String(count);
}

export function formatRelativeTime(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const minutes = Math.floor((now - then) / 60_000);
  if (minutes < 1) return i18n.t('notifications:relative.now');
  if (minutes < 60) return i18n.t('notifications:relative.minutes', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return i18n.t('notifications:relative.hours', { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return i18n.t('notifications:relative.days', { count: days });
  return new Date(then).toLocaleDateString(i18n.language, { day: '2-digit', month: 'short' });
}
