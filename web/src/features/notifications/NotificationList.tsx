import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { CloseButton } from '@/shared/ui/primitives/close-button';
import { Button } from '@/shared/ui/primitives/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { Avatar } from '@/shared/Avatar';
import { ServerIcon } from '@/features/servers/ServerIcon';
import { LoadMoreFooter } from '@/features/friends/LoadMoreFooter';
import { useCursorList } from '@/shared/hooks/useCursorList';
import { useFriends } from '@/features/friends/FriendsContext';
import { fetchNotifications } from '@/shared/api/api';
import type { NotificationEntry } from '@/shared/api/api';
import { cn } from '@/shared/lib/utils';
import { describeNotification, formatRelativeTime } from './notificationText';

function NotificationIcon({ entry }: { entry: NotificationEntry }) {
  if (entry.kind === 'server_invitation' && entry.server) return <ServerIcon id={entry.server.id} name={entry.server.name} icon={entry.server.icon} size={36} active />;
  // a webhook's mention has no account: its server's picture stands for it
  const channel = entry.kind === 'mention' && !entry.actor && entry.mention?.conversation.serverId ? entry.mention.conversation : null;
  if (channel) return <ServerIcon id={channel.serverId!} name={channel.serverName} icon={channel.serverIcon} size={36} active />;
  const actor = entry.actor;
  return <Avatar id={actor?.id ?? entry.id} name={actor?.displayName ?? '?'} avatar={actor?.avatar ?? ''} avatarColor={actor?.avatarColor ?? 'blurple'} size={36} className="flex-none" />;
}

const notificationKey = (entry: NotificationEntry) => entry.id;

export function NotificationList({ onSelect, onDismiss, fullPage = false }: { onSelect: (entry: NotificationEntry) => void; onDismiss: (entry: NotificationEntry) => void; fullPage?: boolean }) {
  const { t } = useTranslation('notifications');
  const { revision } = useFriends();
  const fetchPage = useCallback((cursor: string | null) => fetchNotifications(cursor), []);
  const list = useCursorList(fetchPage, 'notifications', { revision, getKey: notificationKey });

  if (list.status === 'loading') return <p className="py-6 text-center text-label text-text-muted">{t('list.loading')}</p>;
  if (list.status === 'error') {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center">
        <p className="text-label text-text-muted">{t('list.loadFailed')}</p>
        <Button type="button" variant="secondary" size="sm" onClick={list.retry}>{t('actions.retry')}</Button>
      </div>
    );
  }
  if (list.items.length === 0) {
    return (
      <EmptyState size={fullPage ? 'default' : 'compact'} illustration="bell" title={t('list.emptyTitle')} description={t('list.empty')} />
    );
  }

  return (
    <div className={cn('flex min-h-0 flex-col overflow-y-auto', fullPage ? 'flex-1' : 'max-h-[min(24rem,60vh)]')}>
    <ul className="flex flex-col">
      {list.items.map((entry) => (
        <li key={entry.id} className="group relative">
          <button
            type="button"
            onClick={() => onSelect(entry)}
            className={cn(
              'flex w-full items-center gap-3 rounded-lg py-2 pl-2 pr-9 text-left transition-colors hover:bg-nav-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              !entry.read && 'bg-accent-primary/[0.08]',
            )}
          >
            <NotificationIcon entry={entry} />
            <span className="min-w-0 flex-1">
              <span className={cn('block text-label text-text-primary', !entry.read && 'font-medium')}>{describeNotification(entry)}</span>
              {entry.mention?.excerpt && <span className="mt-0.5 line-clamp-2 block text-caption text-text-secondary">{entry.mention.excerpt}</span>}
              <span className="block text-caption text-text-muted">{formatRelativeTime(entry.at)}</span>
            </span>
            {!entry.read && <span aria-label={t('actions.unread')} className="size-2 flex-none rounded-full bg-primary" />}
          </button>
          <CloseButton size="xs" label={t('actions.dismiss')} onClick={() => onDismiss(entry)} className="absolute right-1.5 top-1/2 -translate-y-1/2" />
        </li>
      ))}
    </ul>
    <LoadMoreFooter list={list} className="pt-1" />
    </div>
  );
}
