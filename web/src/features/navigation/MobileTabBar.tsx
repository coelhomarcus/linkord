import { ChatCircleIcon, RobotIcon, UsersIcon } from '@phosphor-icons/react';
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { Avatar } from '@/shared/Avatar';
import { CountBadge } from '@/shared/CountBadge';
import { AppLink } from '@/shared/ui/app-link';
import { iconWeight } from '@/shared/ui/icons';
import { useSidebar } from '@/shared/ui/motion/sidebar-context';
import { useContentLocation } from '@/shared/lib/contentLocation';
import { ROUTES, isBotsPath, isConversationsPath } from '@/shared/lib/routes';
import { cn } from '@/shared/lib/utils';
import { useFriends } from '@/features/friends/FriendsContext';
import { unreadCountForTab } from '@/features/conversations/conversationUtils';
import { useRoom } from '@/state/RoomContext';

const itemClass = 'relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-md py-1 text-micro font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring active:bg-fill-active';

function stateClass(active: boolean): string {
  return active ? 'text-text-primary' : 'text-text-muted';
}

function TabIcon({ badge, children }: { badge?: number; children: ReactNode }) {
  return (
    <span className="relative grid size-7 place-items-center">
      {children}
      {!!badge && (
        <CountBadge decorative className="absolute -right-2 -top-1 ring-2 ring-surface-rail">
          {badge > 99 ? '99+' : badge}
        </CountBadge>
      )}
    </span>
  );
}

/** The phone's way around the app, Discord-style: a bar across the bottom of
 * the home screens (the conversation list, friends, bots) in place of the
 * desktop rail and user dock. Inside an open chat it is not drawn, the chat
 * header's back button returns here. */
export function MobileTabBar({ className }: { className?: string }) {
  const { pendingIncomingCount } = useFriends();
  const { state, conversations, unreadByConversation, reconnecting } = useRoom();
  const { setOpenMobile } = useSidebar();
  const navigate = useNavigate();
  const { pathname } = useContentLocation();
  const onSettings = useLocation().pathname.startsWith(ROUTES.settings);
  const conversationsUnread = useMemo(
    () => unreadCountForTab(conversations, unreadByConversation, 'direct') + unreadCountForTab(conversations, unreadByConversation, 'group'),
    [conversations, unreadByConversation],
  );
  const botsUnread = useMemo(() => unreadCountForTab(conversations, unreadByConversation, 'bot'), [conversations, unreadByConversation]);
  const onConversations = isConversationsPath(pathname);
  const onFriends = pathname === ROUTES.friends;
  const onBots = isBotsPath(pathname);

  return (
    <nav
      aria-label="Navegação principal"
      className={cn('flex h-14 flex-none items-stretch gap-1 border-t border-border-subtle bg-surface-rail px-2', className)}
    >
      {/* the list pages are the drawer: going to one shows it, friends is a page under it */}
      <AppLink
        to={ROUTES.conversations}
        onClick={() => setOpenMobile(true)}
        aria-current={onConversations ? 'page' : undefined}
        aria-label={conversationsUnread > 0 ? `Conversas, ${conversationsUnread} não lidas` : 'Conversas'}
        className={cn(itemClass, stateClass(onConversations))}
      >
        <TabIcon badge={conversationsUnread}><ChatCircleIcon size={24} weight={iconWeight(onConversations)} aria-hidden /></TabIcon>
        <span aria-hidden>Conversas</span>
      </AppLink>
      <AppLink
        to={ROUTES.friends}
        onClick={() => setOpenMobile(false)}
        aria-current={onFriends ? 'page' : undefined}
        aria-label={pendingIncomingCount > 0 ? `Amigos, ${pendingIncomingCount} aguardando resposta` : 'Amigos'}
        className={cn(itemClass, stateClass(onFriends))}
      >
        <TabIcon badge={pendingIncomingCount}><UsersIcon size={24} weight={iconWeight(onFriends)} aria-hidden /></TabIcon>
        <span aria-hidden>Amigos</span>
      </AppLink>
      <AppLink
        to={ROUTES.bots}
        onClick={() => setOpenMobile(true)}
        aria-current={onBots ? 'page' : undefined}
        aria-label={botsUnread > 0 ? `Bots, ${botsUnread} não lidas` : 'Bots'}
        className={cn(itemClass, stateClass(onBots))}
      >
        <TabIcon badge={botsUnread}><RobotIcon size={24} weight={iconWeight(onBots)} aria-hidden /></TabIcon>
        <span aria-hidden>Bots</span>
      </AppLink>
      <button
        type="button"
        // a button, not a link: settings open as a modal over whatever is here
        onClick={() => navigate(ROUTES.settings)}
        aria-label="Você"
        aria-haspopup="dialog"
        aria-expanded={onSettings}
        className={cn(itemClass, stateClass(onSettings))}
      >
        <span className="relative grid size-7 place-items-center">
          <Avatar id={state.me.userId ?? state.me.id ?? 'me'} name={state.me.displayName} avatar={state.me.avatar} avatarColor={state.me.avatarColor} size={24} className={cn(onSettings && 'ring-2 ring-text-primary')} />
          <span aria-hidden className={cn('absolute bottom-0 right-0 size-2.5 rounded-full border-2 border-surface-rail', reconnecting ? 'bg-text-muted' : 'bg-green')} />
        </span>
        <span aria-hidden>Você</span>
      </button>
    </nav>
  );
}
