import { MagnifyingGlassIcon, PhoneIcon, PlusIcon, PushPinIcon, RobotIcon, SidebarSimpleIcon, UsersIcon } from '@phosphor-icons/react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

import { ActiveWash } from '@/shared/ui/motion/active-wash';
import { Sidebar } from '@/shared/ui/motion/sidebar';
import { useSidebar } from '@/shared/ui/motion/sidebar-context';
import { Button } from '@/shared/ui/primitives/button';
import { Tabs, TabsIndicator, TabsList, TabsTrigger } from '@/shared/ui/primitives/tabs';
import { Avatar } from '@/shared/Avatar';
import { cn } from '@/shared/lib/utils';
import { useContentLocation } from '@/shared/lib/contentLocation';
import { CountBadge } from '@/shared/CountBadge';
import { useRoom } from '@/state/RoomContext';
import type { Conversation } from '@/shared/types/protocol';
import { ROUTES, conversationNav, isConversationsPath } from '@/shared/lib/routes';
import {
  conversationMatchesQuery,
  conversationTitle,
  directUser,
  unreadCountForTab,
  type ConversationListTab,
} from './conversationUtils';
import { GroupAvatar } from './GroupAvatar';
import { GroupCreateDialog } from './GroupCreateDialog';
import { NotificationBell } from '@/features/notifications/NotificationBell';
import { BotCreateDialog } from '@/features/bots/BotCreateDialog';
import { MobileTabBar } from '@/features/navigation/MobileTabBar';
import { CallDock } from '@/features/calls/CallDock';

interface ConversationSidebarProps {
  onReturnToCall: () => void;
  onOpenProfile: (userId: string) => void;
  showReturnToCall: boolean;
}

function ConversationRow({ conversation, active, washId, onClick }: {
  conversation: Conversation;
  active: boolean;
  /** shared by every row: there is one wash, and it slides to the active row */
  washId: string;
  onClick: () => void;
}) {
  const { state, allUsers, onlineUserIds, unreadByConversation, activeCallConversationId } = useRoom();
  const title = conversationTitle(conversation, state.me.userId, allUsers);
  const other = directUser(conversation, state.me.userId, allUsers);
  const unread = unreadByConversation.get(conversation.id) ?? 0;
  // `state.participants` never includes yourself (server excludes you from
  // it) — same "prepend me if it's my active call" pattern as
  // ConversationPanel.tsx's header avatar stack.
  const otherCallParticipants = [...state.participants.values()].filter((p) => p.callConversationId === conversation.id);
  const callParticipants = activeCallConversationId === conversation.id
    ? [{ id: state.me.userId ?? 'me', displayName: state.me.displayName, avatar: state.me.avatar, avatarColor: state.me.avatarColor }, ...otherCallParticipants]
    : otherCallParticipants;
  const hasActiveCall = callParticipants.length > 0;
  const online = other ? onlineUserIds.has(other.id) : false;

  return (
    <div data-conversation-id={conversation.id} data-user-id={other?.id}>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'relative isolate flex w-full items-center gap-2.5 rounded-md border px-2.5 py-2 text-left transition-colors',
          active
            ? 'cutout-active border-transparent text-text-primary'
            : 'cutout border-transparent text-text-secondary hover:cutout-subtle hover:border-border hover:bg-fill-subtle active:bg-fill-active'
        )}
      >
        {/* Discord/Fluxer: the active row is a plain light-gray wash, no border
            and no accent color — the color is reserved for actual brand
            moments, not "you are here" state */}
        {active && <ActiveWash layoutId={washId} className="shadow-highlight" />}
        {conversation.type === 'direct' && other ? (
          <div className="relative flex-none">
            <Avatar id={other.id} name={other.displayName} avatar={other.avatar} avatarColor={other.avatarColor} size={44} />
            <span className={cn('absolute -bottom-0.5 -right-0.5 size-4 rounded-full border-2 border-(--cutout) transition-[border-color] duration-300', online ? 'bg-green' : 'bg-text-muted')} />
          </div>
        ) : (
          <div className="relative flex-none">
            <GroupAvatar id={conversation.id} title={title} avatar={conversation.avatar} active={active} size={44} />
            <span className="absolute -bottom-0.5 -right-0.5 grid size-5 place-items-center rounded-full border-2 border-(--cutout) bg-bg-tertiary text-text-secondary transition-[border-color] duration-300">
              {conversation.type === 'bot' ? <RobotIcon size={14} weight="fill" /> : <UsersIcon size={14} weight="fill" />}
            </span>
          </div>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-label font-semibold max-md:text-body">{title}</span>
          {/* Discord-style: just the avatar and name — no last-message time.
              The only thing that goes in this second line is who's on a
              call right now, same spot the time used to sit in. */}
          {hasActiveCall && (
            <span className="mt-0.5 flex items-center gap-1.5">
              <PhoneIcon size={14} weight="fill" className="flex-none text-green" />
              <span className="flex items-center -space-x-1.5">
                {callParticipants.slice(0, 4).map((p) => (
                  <Avatar key={p.id} id={p.id} name={p.displayName} avatar={p.avatar} avatarColor={p.avatarColor} size={16} className="ring-2 ring-(--cutout) transition-[box-shadow] duration-300" />
                ))}
                {callParticipants.length > 4 && (
                  <span className="grid size-4 place-items-center rounded-full bg-bg-tertiary text-[9px] font-semibold text-text-secondary ring-2 ring-(--cutout) transition-[box-shadow] duration-300">
                    +{callParticipants.length - 4}
                  </span>
                )}
              </span>
            </span>
          )}
        </span>
        <span className="flex flex-none flex-col items-end gap-1">
          {!!conversation.pinnedAt && (
            <span className="flex items-center">
              <PushPinIcon size={14} weight="fill" className="text-text-muted" />
            </span>
          )}
          {unread > 0 && (
            <CountBadge className="h-5 min-w-5 px-1.5 text-micro">
              {unread > 99 ? '99+' : unread}
            </CountBadge>
          )}
        </span>
      </button>
    </div>
  );
}

function tabForConversation(conversations: Conversation[], conversationId: string | null): ConversationListTab {
  const conversation = conversationId ? conversations.find((item) => item.id === conversationId) : undefined;
  return conversation?.type === 'group' || conversation?.type === 'bot' ? conversation.type : 'direct';
}

// what each tab's + creates, searches for, and says when it has nothing
const TAB_COPY: Record<ConversationListTab, { search: string; empty: string; create: string }> = {
  direct: { search: 'Buscar amigos', empty: 'Nenhuma conversa.', create: 'Criar grupo' },
  group: { search: 'Buscar grupos', empty: 'Nenhum grupo.', create: 'Criar grupo' },
  bot: { search: 'Buscar bots', empty: 'Nenhum bot ainda. Crie um para receber avisos dos seus sistemas.', create: 'Criar bot' },
};

export function ConversationSidebar({ onReturnToCall, onOpenProfile, showReturnToCall }: ConversationSidebarProps) {
  const { state, conversations, activeConversationId, openConversation, allUsers, unreadByConversation, requestChatView, activeCallConversationId } = useRoom();
  const { isMobile, isOverlay, setOpenMobile, toggleSidebar } = useSidebar();
  const navigate = useNavigate();
  const { pathname } = useContentLocation();
  const [query, setQuery] = useState('');
  const [groupOpen, setGroupOpen] = useState(false);
  const [botOpen, setBotOpen] = useState(false);
  const [tab, setTab] = useState<ConversationListTab>(() => tabForConversation(conversations, activeConversationId));
  const prevActiveId = useRef(activeConversationId);
  const washId = useId();
  const searching = query.trim().length > 0;

  useEffect(() => {
    if (activeConversationId && activeConversationId !== prevActiveId.current) {
      setTab(tabForConversation(conversations, activeConversationId));
    }
    prevActiveId.current = activeConversationId;
  }, [activeConversationId, conversations]);

  const filteredConversations = useMemo(() => (
    conversations.filter((conversation) => conversation.type === tab && conversationMatchesQuery(conversation, query, state.me.userId, allUsers))
  ), [allUsers, conversations, query, state.me.userId, tab]);

  const friendsUnread = useMemo(() => unreadCountForTab(conversations, unreadByConversation, 'direct'), [conversations, unreadByConversation]);
  const groupsUnread = useMemo(() => unreadCountForTab(conversations, unreadByConversation, 'group'), [conversations, unreadByConversation]);
  const botsUnread = useMemo(() => unreadCountForTab(conversations, unreadByConversation, 'bot'), [conversations, unreadByConversation]);

  function selectConversation(conversationId: string) {
    openConversation(conversationId);
    // explicit, not left to the URL sync: re-opening the conversation that is
    // ALREADY active (from the friends page, say) changes no state, so nothing
    // else would navigate. Done before requestChatView so that call sees a
    // conversations path and doesn't push a second history entry.
    navigate(ROUTES.conversations, conversationNav(conversationId));
    requestChatView();
    if (isOverlay) setOpenMobile(false);
  }

  const onConversations = isConversationsPath(pathname);
  const copy = TAB_COPY[tab];
  const emptyText = searching ? (tab === 'bot' ? 'Nenhum bot.' : tab === 'group' ? 'Nenhum grupo.' : 'Nenhuma conversa.') : copy.empty;
  const list = (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex flex-col gap-1">
        {filteredConversations.length === 0 ? (
          <p className="select-none px-3 py-8 text-center text-label text-text-muted">{emptyText}</p>
        ) : filteredConversations.map((conversation) => (
          <ConversationRow
            key={conversation.id}
            conversation={conversation}
            active={onConversations && conversation.id === activeConversationId}
            washId={washId}
            onClick={() => selectConversation(conversation.id)}
          />
        ))}
      </div>
    </div>
  );

  return (
    <>
      <Sidebar ariaLabel="Conversas" className="text-text-primary" panelClassName="bg-bg-primary">
        <div className="relative flex h-full min-h-0 flex-col">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {/* from md the content card sits one shell gap (and its border) below the
                top: starting there too puts this title on the same line as the page's */}
            <div className="flex h-header flex-none items-center gap-2 px-4 md:mt-[calc(var(--spacing-shell)+1px)]">
              <h1 className="min-w-0 flex-1 select-none truncate text-title font-semibold">Conversas</h1>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={copy.create} onClick={() => (tab === 'bot' ? setBotOpen(true) : setGroupOpen(true))} className="flex-none text-text-muted hover:text-text-primary">
                <PlusIcon size={20} />
              </Button>
              <NotificationBell onNavigate={() => { if (isOverlay) setOpenMobile(false); }} />
              {!isOverlay && (
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Ocultar lista de conversas" onClick={toggleSidebar} className="flex-none text-text-muted hover:text-text-primary">
                  <SidebarSimpleIcon size={20} />
                </Button>
              )}
            </div>

            {/* as a column, the gap to the content is the content card's own margin, which stays when the list is hidden */}
            <div className="flex min-h-0 flex-1 flex-col gap-3 pb-[max(0.75rem,var(--dock-list-clearance,0px))] pl-3 pr-shell lg:pr-0">
              <div className="flex flex-none items-center gap-2 rounded-md border border-border bg-fill-subtle px-3">
                <MagnifyingGlassIcon size={20} className="text-text-muted" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={copy.search}
                  className="h-10 min-w-0 flex-1 bg-transparent text-label outline-none placeholder:text-text-muted"
                />
              </div>

              <Tabs
                value={tab}
                onValueChange={(value) => { if (value === 'direct' || value === 'group' || value === 'bot') setTab(value); }}
                className="flex min-h-0 w-full flex-1 flex-col items-stretch gap-3"
              >
                <TabsList className="flex h-10 w-full flex-none" aria-label="Tipo de conversa">
                  <TabsIndicator />
                  <TabsTrigger value="direct" className="flex-1">
                    Amigos
                    {friendsUnread > 0 && (
                      <CountBadge decorative>{friendsUnread > 99 ? '99+' : friendsUnread}</CountBadge>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="group" className="flex-1">
                    Grupos
                    {groupsUnread > 0 && (
                      <CountBadge decorative>{groupsUnread > 99 ? '99+' : groupsUnread}</CountBadge>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="bot" className="flex-1">
                    Bots
                    {botsUnread > 0 && (
                      <CountBadge decorative>{botsUnread > 99 ? '99+' : botsUnread}</CountBadge>
                    )}
                  </TabsTrigger>
                </TabsList>
                {list}
              </Tabs>
            </div>
          </div>
          {/* from 768px the rail and the user dock float beside the list; on a phone the
              tab bar stands in for both, and the call's own card only shows during a call */}
          {isMobile && activeCallConversationId && (
            <div className="flex-none px-3 pb-2">
              <CallDock
                onReturnToCall={() => { setOpenMobile(false); onReturnToCall(); }}
                onOpenProfile={onOpenProfile}
                showReturnToCall={showReturnToCall}
                onNavigate={() => setOpenMobile(false)}
              />
            </div>
          )}
          {isMobile && <MobileTabBar />}
        </div>
      </Sidebar>
      <GroupCreateDialog
        open={groupOpen}
        onOpenChange={setGroupOpen}
        onCreated={() => { if (isOverlay) setOpenMobile(false); }}
      />
      <BotCreateDialog open={botOpen} onOpenChange={setBotOpen} />
    </>
  );
}
