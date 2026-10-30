import { BellIcon, ChatCircleIcon, PhoneIcon, UserCircleIcon, UsersIcon } from '@phosphor-icons/react';
import { useMemo } from 'react';
import { Avatar } from '@/shared/Avatar';
import { CountBadge } from '@/shared/CountBadge';
import { useFriends } from '@/features/friends/FriendsContext';
import { useUnreadNotifications } from '@/features/notifications/useUnreadNotifications';
import { conversationTitle, unreadCountForTab } from '@/features/conversations/conversationUtils';
import { useContentLocation } from '@/shared/lib/contentLocation';
import { ROUTES } from '@/shared/lib/routes';
import { AppLink } from '@/shared/ui/app-link';
import { useRoom } from '@/state/RoomContext';

export function MobileTabBar({ activeCallConversationId, onReturnToCall }: { activeCallConversationId: string | null; onReturnToCall: () => void }) {
  const { pathname } = useContentLocation();
  const { state, conversations, unreadByConversation, allUsers } = useRoom();
  const { pendingIncomingCount } = useFriends();
  const { unread: notificationsUnread } = useUnreadNotifications();
  const conversationsUnread = useMemo(() => (
    unreadCountForTab(conversations, unreadByConversation, 'direct') +
    unreadCountForTab(conversations, unreadByConversation, 'group') +
    unreadCountForTab(conversations, unreadByConversation, 'bot')
  ), [conversations, unreadByConversation]);
  const call = conversations.find((item) => item.id === activeCallConversationId);
  const tabs = [
    { to: ROUTES.conversations, label: 'Conversas', icon: ChatCircleIcon, count: conversationsUnread },
    { to: ROUTES.friends, label: 'Amigos', icon: UsersIcon, count: pendingIncomingCount },
    { to: ROUTES.notifications, label: 'Notificações', icon: BellIcon, count: notificationsUnread },
    { to: ROUTES.profile, label: 'Perfil', icon: UserCircleIcon, count: 0 },
  ] as const;

  return (
    <div className="fixed inset-x-0 bottom-[var(--app-viewport-bottom,0px)] z-30 bg-bg-primary md:hidden">
      {activeCallConversationId && (
        <button type="button" onClick={onReturnToCall} className="flex h-12 w-full items-center gap-2 border-b border-border bg-bg-secondary px-4 text-left text-label">
          <PhoneIcon size={18} weight="fill" className="flex-none text-green" aria-hidden />
          <span className="min-w-0 flex-1 truncate">Em chamada: {conversationTitle(call, state.me.userId, allUsers)}</span>
          <span className="font-semibold text-green">Voltar</span>
        </button>
      )}
      <nav aria-label="Navegação principal" className="grid h-16 grid-cols-4 items-stretch pb-0">
        {tabs.map(({ to, label, icon: Icon, count }) => {
          const active = pathname === to;
          const accessibleLabel = count > 0
            ? `${label}, ${count} ${to === ROUTES.friends ? (count === 1 ? 'solicitação pendente' : 'solicitações pendentes') : (count === 1 ? 'não lida' : 'não lidas')}`
            : label;
          return (
            <AppLink key={to} to={to} aria-label={accessibleLabel} aria-current={active ? 'page' : undefined} className={`relative flex min-w-0 flex-col items-center justify-center gap-0.5 text-caption ${active ? 'font-semibold text-primary' : 'text-text-muted'}`}>
              {active && <span aria-hidden className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-primary" />}
              <span className="relative">
                {to === ROUTES.profile ? <Avatar id={state.me.userId ?? state.me.id ?? 'me'} name={state.me.displayName} avatar={state.me.avatar} avatarColor={state.me.avatarColor} size={24} /> : <Icon size={24} weight={active ? 'fill' : 'regular'} aria-hidden />}
                {count > 0 && <CountBadge decorative className="absolute -right-3 -top-1 min-w-4 px-1 text-[10px]">{count > 99 ? '99+' : count}</CountBadge>}
              </span>
              <span className="truncate">{label}</span>
            </AppLink>
          );
        })}
      </nav>
      <div aria-hidden className="h-[env(safe-area-inset-bottom)]" />
    </div>
  );
}
