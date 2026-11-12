import { BellSlashIcon, PhoneIcon, PlusIcon, UsersIcon, XIcon } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';

import { ActiveFill } from '@/shared/ui/active-fill';
import { EmptyState } from '@/shared/ui/empty-state';
import { Button } from '@/shared/ui/primitives/button';
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
import { StatusDot } from '@/features/status/StatusDot';
import { CustomStatusText } from '@/features/status/CustomStatusText';
import { useCustomStatus, useUserStatus } from '@/features/status/statusDisplay';

function DirectRow({ conversation, active, onClick, onClose }: {
  conversation: Conversation; active: boolean; onClick: () => void; onClose: () => void;
}) {
  const { t } = useTranslation('conversations');
  const { t: tn } = useTranslation('notifications');
  const { state, allUsers, badgeByConversation, notificationPolicyFor, activeCallConversationId } = useRoom();
  const title = conversationTitle(conversation, state.me.userId, allUsers);
  const other = directUser(conversation, state.me.userId, allUsers);
  const unread = badgeByConversation.get(conversation.id) ?? 0;
  const muted = notificationPolicyFor({ id: conversation.id }).muted;
  const status = useUserStatus(other?.id);
  const customStatus = useCustomStatus(other?.id);
  const inCall = activeCallConversationId === conversation.id;
  return (
    <li data-conversation-id={conversation.id} data-user-id={other?.id} className="group/dm relative mx-2">
      <button
        type="button"
        onClick={onClick}
        data-avatar-hover
        aria-label={`${unread > 0 ? t('sidebar.rowUnread', { name: title, count: unread }) : title}${muted ? `, ${tn('preferences.muted')}` : ''}`}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'relative isolate flex w-full items-center gap-3 rounded-lg px-2 text-left',
          inCall ? 'h-auto min-h-11 py-1' : 'h-11',
          unread > 0 ? 'pr-10' : 'group-hover/dm:pr-10 group-focus-within/dm:pr-10',
          active ? 'cutout-active text-text-primary' : cn('cutout md:hover:cutout-subtle md:hover:bg-nav-hover', unread ? 'text-text-primary' : 'text-text-muted md:hover:text-text-primary'),
        )}
      >
        {active && <ActiveFill />}
        <span className="relative flex-none">
          {other
            ? <Avatar id={other.id} name={other.displayName} avatar={other.avatar} poster={other.avatarPoster} animateOnHover avatarColor={other.avatarColor} size={32} />
            : <span className="block size-8 rounded-full bg-fill-hover" />}
          {inCall ? (
            <span className="absolute -bottom-0.5 -right-0.5 grid size-4 place-items-center rounded-full border-[3px] border-(--cutout) bg-green text-black">
              <PhoneIcon size={10} weight="fill" />
            </span>
          ) : (
            <StatusDot status={status} className="absolute -bottom-0.5 -right-0.5 size-3.5 border-[3px] text-(--cutout)" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1">
            <span className={cn('truncate text-body', unread ? 'font-semibold' : 'font-medium', muted && !active && !unread && 'opacity-60')}>{title}</span>
            {muted && <BellSlashIcon size={14} className="flex-none text-text-muted" aria-label={tn('preferences.muted')} role="img" />}
          </span>
          {inCall ? (
            <span className="block truncate text-label text-green">{t('sidebar.inThisCall')}</span>
          ) : (
            <CustomStatusText custom={customStatus} className="text-caption text-text-muted" />
          )}
        </span>
      </button>
      {unread > 0 && (
        <CountBadge decorative className="pointer-events-none absolute right-2 top-1/2 h-5 min-w-5 -translate-y-1/2 px-1.5 text-micro transition-transform duration-200 ease-out group-hover/dm:-translate-x-7 group-focus-within/dm:-translate-x-7">
          {unread > 99 ? '99+' : unread}
        </CountBadge>
      )}
      <button type="button" onClick={onClose} aria-label={t('sidebar.close', { name: title })}
        className="pointer-events-none absolute right-2 top-1/2 grid size-6 -translate-y-1/2 scale-90 place-items-center rounded-md text-text-muted opacity-0 transition-all duration-150 group-hover/dm:pointer-events-auto group-hover/dm:scale-100 group-hover/dm:opacity-100 group-focus-within/dm:pointer-events-auto group-focus-within/dm:scale-100 group-focus-within/dm:opacity-100 hover:bg-fill-hover hover:text-text-primary focus-visible:pointer-events-auto focus-visible:scale-100 focus-visible:opacity-100">
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
              active={conversation.id === visibleId}
              onClick={() => select(conversation.id)}
              onClose={() => { closeConversation(conversation.id); if (visibleId === conversation.id) navigate(ROUTES.home, { replace: true }); }}
            />
          ))}
        </ul>
        {directs.length === 0 && (query.trim() ? (
          <EmptyState
            size="compact"
            illustration="search"
            title={t('sidebar.noMatch')}
            description={t('sidebar.noMatchText', { query: query.trim() })}
            action={<Button type="button" variant="secondary" size="sm" onClick={() => setQuery('')}>{t('sidebar.clearSearch')}</Button>}
          />
        ) : (
          <EmptyState
            size="compact"
            illustration="chat"
            title={t('sidebar.emptyTitle')}
            description={t('sidebar.empty')}
            action={<Button type="button" variant="secondary" size="sm" onClick={() => setNewOpen(true)}><PlusIcon size={16} aria-hidden />{t('sidebar.startConversation')}</Button>}
          />
        ))}
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
    ? <ChannelList server={server} activeChannelId={conversationIdFromPath(pathname)} onNavigate={afterNavigate} onOpenProfile={onOpenProfile} />
    : <DirectList onNavigate={afterNavigate} />;

  if (isMobile) {
    // a phone shows the column as its own page, only where nothing is open
    const listPage = pathname === ROUTES.home || pathname === '/app/channels' || (!!serverId && !conversationIdFromPath(pathname));
    if (listPage) {
      return (
        <main aria-label={server?.name ?? t('sidebar.title')} className="flex min-h-0 min-w-0 flex-1 bg-bg-primary pb-[var(--mobile-navigation-height)] text-text-primary">
          <ServerRail />
          <div className="flex min-w-0 flex-1 flex-col rounded-tl-xl bg-bg-secondary">{content}</div>
        </main>
      );
    }
    // in a conversation the same list is a drawer, opened by the edge swipe
    return (
      <Sidebar ariaLabel={server?.name ?? t('sidebar.title')} leadingInset={false} className="text-text-primary">
        <div className="flex h-full min-h-0">
          <ServerRail />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg-secondary">{content}</div>
        </div>
      </Sidebar>
    );
  }
  return (
    <Sidebar ariaLabel={isHomePath(pathname) ? t('sidebar.title') : server?.name ?? t('sidebar.title')} className="text-text-primary" panelClassName="border-r border-border-subtle bg-surface-app">
      {content}
    </Sidebar>
  );
}
