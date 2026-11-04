import { TrayIcon, ChatCircleIcon, PhoneIcon, SquaresFourIcon, UserCircleIcon } from '@phosphor-icons/react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/shared/Avatar';
import { CountBadge } from '@/shared/CountBadge';
import { useFriends } from '@/features/friends/FriendsContext';
import { useUnreadNotifications } from '@/features/notifications/useUnreadNotifications';
import { conversationTitle } from '@/features/conversations/conversationUtils';
import { serverUnread } from '@/features/servers/serverUtils';
import { useContentLocation } from '@/shared/lib/contentLocation';
import { ROUTES, isHomePath, serverIdFromPath } from '@/shared/lib/routes';
import { AppLink } from '@/shared/ui/app-link';
import { useRoom } from '@/state/RoomContext';

/** The phone's top-level sections. Switching one replaces the history entry:
 * they are siblings, so a back swipe leaves the section instead of walking
 * through every tab visited, the way a native tab bar behaves. */
export function MobileTabBar({ activeCallConversationId, onReturnToCall }: { activeCallConversationId: string | null; onReturnToCall: () => void }) {
  const { t } = useTranslation('navigation');
  const { pathname } = useContentLocation();
  const { state, conversations, servers, unreadByConversation, allUsers } = useRoom();
  const { pendingIncomingCount } = useFriends();
  const { unread: notificationsUnread } = useUnreadNotifications();
  const directUnread = useMemo(
    () => conversations.reduce((sum, c) => sum + (c.type === 'direct' ? unreadByConversation.get(c.id) ?? 0 : 0), 0),
    [conversations, unreadByConversation],
  );
  const serversUnread = useMemo(() => servers.reduce((sum, server) => sum + serverUnread(server, unreadByConversation), 0), [servers, unreadByConversation]);
  const call = conversations.find((item) => item.id === activeCallConversationId);
  const currentServerId = serverIdFromPath(pathname);
  // the Servers tab goes back to the server last open, its channel list on screen
  const serverTab = currentServerId ? ROUTES.server(currentServerId) : servers[0] ? ROUTES.server(servers[0].id) : ROUTES.home;
  const tabs = [
    { key: 'servers', to: serverTab, label: t('servers'), icon: SquaresFourIcon, count: serversUnread, active: !!currentServerId },
    { key: 'messages', to: ROUTES.home, label: t('messages'), icon: ChatCircleIcon, count: directUnread + pendingIncomingCount, active: isHomePath(pathname) },
    { key: 'notifications', to: ROUTES.notifications, label: t('notifications'), icon: TrayIcon, count: notificationsUnread, active: pathname === ROUTES.notifications },
    { key: 'profile', to: ROUTES.profile, label: t('profile'), icon: UserCircleIcon, count: 0, active: pathname === ROUTES.profile },
  ] as const;

  return (
    <div className="absolute inset-x-0 bottom-0 z-30 bg-bg-primary md:hidden">
      {activeCallConversationId && (
        <button type="button" onClick={onReturnToCall} className="flex h-12 w-full items-center gap-2 border-b border-border bg-bg-secondary px-4 text-left text-label">
          <PhoneIcon size={18} weight="fill" className="flex-none text-green" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{t('inCall', { title: conversationTitle(call, state.me.userId, allUsers) })}</span>
          <span className="font-semibold text-green">{t('returnToCall')}</span>
        </button>
      )}
      <nav aria-label={t('main')} className="grid h-16 grid-cols-4 items-stretch pb-0">
        {tabs.map(({ key, to, label, icon: Icon, count, active }) => {
          const accessibleLabel = count > 0 ? t('tabUnread', { label, count }) : label;
          return (
            <AppLink key={key} to={to} replace aria-label={accessibleLabel} aria-current={active ? 'page' : undefined} className={`relative flex min-w-0 flex-col items-center justify-center gap-0.5 text-caption ${active ? 'font-semibold text-primary' : 'text-text-muted'}`}>
              {active && <span aria-hidden className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-primary" />}
              <span className="relative">
                {key === 'profile' ? <Avatar id={state.me.userId ?? state.me.id ?? 'me'} name={state.me.displayName} avatar={state.me.avatar} avatarColor={state.me.avatarColor} size={24} /> : <Icon size={24} weight={active ? 'fill' : 'regular'} aria-hidden />}
                {count > 0 && <CountBadge decorative className="absolute -right-3 -top-1 min-w-4 px-1 text-[10px]">{count > 99 ? '99+' : count}</CountBadge>}
              </span>
              <span className="truncate">{label}</span>
            </AppLink>
          );
        })}
      </nav>
      <div aria-hidden className="h-(--safe-bottom)" />
    </div>
  );
}
