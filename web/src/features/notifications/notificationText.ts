import type { NotificationEntry } from '@/shared/api/api';
import { ROUTES, friendsSection, friendsView } from '@/shared/lib/routes';

/** Where a mention happened, as the sentence ends: a DM is just "em uma
 * conversa", since who wrote it already says which one. */
function mentionPlace(entry: NotificationEntry): string {
  const conversation = entry.mention?.conversation;
  if (!conversation || conversation.type === 'direct') return 'em uma conversa';
  return conversation.type === 'bot' ? `no bot ${conversation.title || 'Bot'}` : `no grupo ${conversation.title || 'Grupo'}`;
}

export function describeNotification(entry: NotificationEntry): string {
  const who = entry.actor?.displayName ?? 'Alguém';
  switch (entry.kind) {
    case 'friend_request': return `${who} enviou uma solicitação de amizade`;
    case 'friend_accepted': return `${who} aceitou sua solicitação de amizade`;
    case 'group_invitation': return `${who} convidou você para ${entry.group ? `o grupo ${entry.group.title}` : 'um grupo'}`;
    case 'mention': {
      // a bot has no account behind it: the bot itself is who mentioned you
      if (!entry.actor && entry.mention?.conversation.type === 'bot') return `${entry.mention.conversation.title || 'Um bot'} mencionou você`;
      return `${who} mencionou você ${mentionPlace(entry)}`;
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
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `há ${days} d`;
  return new Date(then).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}
