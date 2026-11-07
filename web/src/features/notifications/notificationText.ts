import { i18n } from '@/shared/i18n/init';
import type { NotificationEntry } from '@/shared/api/api';
import { ROUTES, friendsSection } from '@/shared/lib/routes';

type NotificationTextKey =
  | 'unknownActor'
  | 'friendRequest'
  | 'friendAccepted'
  | 'serverInvitationNamed'
  | 'serverInvitationUnnamed'
  | 'mentionBot'
  | 'mentionDirect'
  | 'mentionChannel';

function text(key: NotificationTextKey, options?: Record<string, string>): string {
  return i18n.t(`notifications:text.${key}`, options);
}

export function describeNotification(entry: NotificationEntry): string {
  const who = entry.actor?.displayName ?? text('unknownActor');
  switch (entry.kind) {
    case 'friend_request': return text('friendRequest', { name: who });
    case 'friend_accepted': return text('friendAccepted', { name: who });
    case 'server_invitation': return entry.server
      ? text('serverInvitationNamed', { name: who, server: entry.server.name })
      : text('serverInvitationUnnamed', { name: who });
    case 'mention': {
      const conversation = entry.mention?.conversation;
      if (!conversation || conversation.type === 'direct') return text('mentionDirect', { name: who });
      const where = `#${conversation.name} · ${conversation.serverName}`;
      // a webhook has no account behind it: the channel is who mentioned you
      if (!entry.actor) return text('mentionBot', { name: where });
      return text('mentionChannel', { name: who, channel: where });
    }
  }
}

export function notificationTarget(entry: NotificationEntry): string {
  switch (entry.kind) {
    case 'friend_request': return friendsSection('received');
    case 'friend_accepted': return ROUTES.friends;
    case 'server_invitation': return friendsSection('invitations');
    // opened by jumping to the message itself (see NotificationBell), not by a route
    case 'mention': return ROUTES.home;
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
