import { PlusIcon, UsersIcon, XIcon } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';

import { ActiveFill } from '@/shared/ui/active-fill';
import { Sidebar } from '@/shared/ui/motion/sidebar';
import { useSidebar } from '@/shared/ui/motion/sidebar-context';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/primitives/tooltip';
import { Avatar } from '@/shared/Avatar';
import { cn } from '@/shared/lib/utils';
import { useContentLocation } from '@/shared/lib/contentLocation';
import { CountBadge } from '@/shared/CountBadge';
import { useRoom } from '@/state/RoomContext';
import type { Conversation } from '@/shared/types/protocol';
import { ROUTES, conversationIdFromPath, isHomePath, serverIdFromPath } from '@/shared/lib/routes';
import { useFriends } from '@/features/friends/FriendsContext';
import { ServerRail } from '@/features/servers/ServerRail';
import { ChannelList } from '@/features/servers/ChannelList';
import { conversationMatchesQuery, conversationTitle, directUser } from './conversationUtils';
import { NewDirectDialog } from './NewDirectDialog';

function DirectRow({ conversation, active, onClick, onClose }: {
  conversation: Conversation; active: boolean; onClick: () => void; onClose: () => void;
}) {
  const { t } = useTranslation('conversations');
  const { state, allUsers, onlineUserIds, unreadByConversation } = useRoom();
  const title = conversationTitle(conversation, state.me.userId, allUsers);
  const other = directUser(conversation, state.me.userId, allUsers);
  const unread = unreadByConversation.get(conversation.id) ?? 0;
  const online = other ? onlineUserIds.has(other.id) : false;
  return (
    <li data-conversation-id={conversation.id} data-user-id={other?.id} className="group/dm relative mx-2">
      <button
        type="button"
        onClick={onClick}
        data-avatar-hover
        aria-label={unread > 0 ? t('sidebar.rowUnread', { name: title, count: unread }) : title}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'relative isolate flex h-11 w-full items-center gap-3 rounded-lg px-2 text-left',
          active ? 'cutout-active text-text-primary' : cn('cutout md:hover:cutout-subtle md:hover:bg-nav-hover', unread ? 'text-text-primary' : 'text-text-muted md:hover:text-text-primary'),
        )}
      >
        {active && <ActiveFill />}
        <span className="relative flex-none">
          {other
            ? <Avatar id={other.id} name={other.displayName} avatar={other.avatar} poster={other.avatarPoster} animateOnHover avatarColor={other.avatarColor} size={32} />
            : <span className="block size-8 rounded-full bg-fill-hover" />}
          <span className={cn('absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full border-[3px] border-(--cutout)', online ? 'bg-green' : 'bg-text-muted')} />
        </span>
        <span className={cn('min-w-0 flex-1 truncate text-body', unread ? 'font-semibold' : 'font-medium')}>{title}</span>
        {unread > 0 && <CountBadge className="h-5 min-w-5 px-1.5 text-micro">{unread > 99 ? '99+' : unread}</CountBadge>}
      </button>
      <button type="button" onClick={onClose} aria-label={t('sidebar.close', { name: title })}
        className="absolute right-2 top-1/2 hidden -translate-y-1/2 rounded-sm p-0.5 text-text-muted hover:text-text-primary group-hover/dm:block">
        <XIcon size={16} />
      </button>
    </li>
  );
}

/** Home's column: find a conversation, Friends, and the DMs. */
function DirectList({ onNavigate }: { onNavigate: () => void }) {
  const { t } = useTranslation('conversations');
  const { state, conversations, allUsers, closeConversation } = useRoom();
  const { pendingIncomingCount } = useFriends();
  const { isMobile } = useSidebar();
  const navigate = useNavigate();
  const { pathname } = useContentLocation();
  const [query, setQuery] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const visibleId = conversationIdFromPath(pathname);
  const directs = useMemo(
    () => conversations.filter((c) => c.type === 'direct' && conversationMatchesQuery(c, query, state.me.userId, allUsers)),
    [conversations, query, state.me.userId, allUsers],
  );
  const onFriends = pathname === ROUTES.home || pathname === ROUTES.friends;

  function select(conversationId: string) {
    // the phone's Voltar returns to this exact entry (see ConversationPanel)
    navigate(ROUTES.direct(conversationId), { state: { from: pathname } });
    onNavigate();
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-header flex-none items-center border-b border-border-subtle px-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={t('sidebar.find')}
          placeholder={t('sidebar.find')}
          className="h-8 w-full rounded-lg border border-border-default bg-surface-300 px-2 text-center text-label font-medium text-text-primary outline-none placeholder:text-text-primary focus:border-border-accent focus:text-left focus:placeholder:text-text-faint"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-[max(0.75rem,var(--dock-list-clearance,0px))] pt-2">
        <div className="mx-2">
          <button type="button" onClick={() => { navigate(isMobile ? ROUTES.friends : ROUTES.home); onNavigate(); }} aria-current={onFriends ? 'page' : undefined}
            className={cn('relative isolate flex h-[38px] w-full items-center gap-3 rounded-lg px-2 text-left text-body font-medium', onFriends ? 'text-text-primary' : 'text-text-muted hover:bg-nav-hover hover:text-text-primary')}>
            {onFriends && <ActiveFill />}
            <UsersIcon size={20} weight="fill" />
            <span className="flex-1">{t('sidebar.friends')}</span>
            {pendingIncomingCount > 0 && <CountBadge className="h-4 min-w-4 px-1 text-micro">{pendingIncomingCount}</CountBadge>}
          </button>
        </div>
        <div aria-hidden className="mx-2 my-2 h-px bg-border-subtle" />
        <div className="group/dm-header flex h-10 items-center px-4 pt-2">
          <span className="flex-1 select-none text-label font-medium text-text-muted group-hover/dm-header:text-text-primary">{t('sidebar.directMessages')}</span>
          <Tooltip>
            <TooltipTrigger onClick={() => setNewOpen(true)} aria-label={t('sidebar.newDirect')} className="text-text-secondary hover:text-text-primary"><PlusIcon size={18} /></TooltipTrigger>
            <TooltipContent>{t('sidebar.newDirect')}</TooltipContent>
          </Tooltip>
        </div>
        <ul className="flex flex-col gap-0.5">
          {directs.map((conversation) => (
            <DirectRow
              key={conversation.id}
              conversation={conversation}
              active={!isMobile && conversation.id === visibleId}
              onClick={() => select(conversation.id)}
              onClose={() => { closeConversation(conversation.id); if (visibleId === conversation.id) navigate(ROUTES.home, { replace: true }); }}
            />
          ))}
        </ul>
        {directs.length === 0 && <p className="select-none px-4 py-6 text-center text-label text-text-muted">{query.trim() ? t('sidebar.noMatch') : t('sidebar.empty')}</p>}
      </div>
      <NewDirectDialog open={newOpen} onOpenChange={setNewOpen} onOpened={onNavigate} />
    </div>
  );
}

/** The second column: home's DMs, or the open server's channels. On a phone
 * it is the main page of the Servers/Messages tabs, drawn next to the rail. */
export function ConversationSidebar({ onOpenProfile }: { onOpenProfile: (userId: string) => void }) {
  const { t } = useTranslation('conversations');
  const { servers } = useRoom();
  const { isMobile, isOverlay, setOpenMobile } = useSidebar();
  const { pathname } = useContentLocation();
  const serverId = serverIdFromPath(pathname);
  const server = serverId ? servers.find((s) => s.id === serverId) ?? null : null;
  const afterNavigate = () => { if (isOverlay) setOpenMobile(false); };
  const content = server
    ? <ChannelList server={server} activeChannelId={isMobile ? null : conversationIdFromPath(pathname)} onNavigate={afterNavigate} onOpenProfile={onOpenProfile} />
    : <DirectList onNavigate={afterNavigate} />;

  if (isMobile) {
    // a phone shows the column as its own page, only where nothing is open
    const listPage = pathname === ROUTES.home || pathname === '/app/channels' || (!!serverId && !conversationIdFromPath(pathname));
    if (!listPage) return null;
    return (
      <main aria-label={server?.name ?? t('sidebar.title')} className="flex min-h-0 min-w-0 flex-1 bg-bg-primary pb-[var(--mobile-navigation-height)] text-text-primary">
        <ServerRail />
        <div className="flex min-w-0 flex-1 flex-col rounded-tl-xl bg-bg-secondary">{content}</div>
      </main>
    );
  }
  return (
    <Sidebar ariaLabel={isHomePath(pathname) ? t('sidebar.title') : server?.name ?? t('sidebar.title')} className="text-text-primary" panelClassName="border-r border-border-subtle bg-surface-app">
      {content}
    </Sidebar>
  );
}
