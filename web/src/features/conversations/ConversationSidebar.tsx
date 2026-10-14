import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Pin, Search, Users, PhoneCall } from 'lucide-react';
import { PanelLeftClose, Plus } from '@/shared/ui/icons';
import { Sidebar } from '@/shared/ui/motion/sidebar';
import { useSidebar } from '@/shared/ui/motion/sidebar-context';
import { Button } from '@/shared/ui/primitives/button';
import { Avatar } from '@/shared/Avatar';
import { cn } from '@/shared/lib/utils';
import { shortcutHint } from '@/shared/lib/platform';
import { CountBadge } from '@/shared/CountBadge';
import { useRoom } from '@/state/RoomContext';
import type { Conversation } from '@/shared/types/protocol';
import { ROUTES, conversationNav, isConversationsPath } from '@/shared/lib/routes';
import { conversationTitle, directUser } from './conversationUtils';
import { GroupAvatar } from './GroupAvatar';
import { GroupCreateDialog } from './GroupCreateDialog';
import { NotificationBell } from '@/features/notifications/NotificationBell';

interface ConversationSidebarProps {
  onOpenPalette: () => void;
  /** the global rail, drawn inside the sheet on a narrow screen (on desktop it sits beside the sidebar) */
  mobileRail: ReactNode;
}

function ConversationRow({ conversation, active, onClick }: {
  conversation: Conversation;
  active: boolean;
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
          'flex w-full items-center gap-2.5 rounded-md border px-2.5 py-1.5 text-left transition-colors',
          // Discord/Fluxer: the active row is a plain light-gray wash, no
          // border and no accent color — the color is reserved for actual
          // brand moments, not "you are here" state.
          active
            ? 'cutout-active border-transparent bg-fill-active text-text-primary shadow-highlight'
            : 'cutout border-transparent text-text-secondary hover:cutout-subtle hover:border-border hover:bg-fill-subtle'
        )}
      >
        {conversation.type === 'direct' && other ? (
          <div className="relative flex-none">
            <Avatar id={other.id} name={other.displayName} avatar={other.avatar} avatarColor={other.avatarColor} size={36} />
            <span className={cn('absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-(--cutout)', online ? 'bg-green' : 'bg-text-muted')} />
          </div>
        ) : (
          <div className="relative flex-none">
            <GroupAvatar title={title} avatar={conversation.avatar} active={active} size={36} />
            <span className="absolute -bottom-0.5 -right-0.5 grid size-4 place-items-center rounded-full border-2 border-(--cutout) bg-bg-tertiary text-text-secondary">
              <Users size={9} />
            </span>
          </div>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-label font-semibold">{title}</span>
          {/* Discord-style: just the avatar and name — no last-message time.
              The only thing that goes in this second line is who's on a
              call right now, same spot the time used to sit in. */}
          {hasActiveCall && (
            <span className="mt-0.5 flex items-center gap-1.5">
              <PhoneCall size={12} className="flex-none text-green" />
              <span className="flex items-center -space-x-1.5">
                {callParticipants.slice(0, 4).map((p) => (
                  <Avatar key={p.id} id={p.id} name={p.displayName} avatar={p.avatar} avatarColor={p.avatarColor} size={16} className="ring-2 ring-(--cutout)" />
                ))}
                {callParticipants.length > 4 && (
                  <span className="grid size-4 place-items-center rounded-full bg-bg-tertiary text-[9px] font-semibold text-text-secondary ring-2 ring-(--cutout)">
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
              <Pin size={11} className="fill-text-muted text-text-muted" />
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

export function ConversationSidebar({ onOpenPalette, mobileRail }: ConversationSidebarProps) {
  const { state, conversations, activeConversationId, openConversation, allUsers, requestChatView } = useRoom();
  const { isMobile, isOverlay, setOpenMobile, toggleSidebar } = useSidebar();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const shortcutK = shortcutHint('K');
  const [query, setQuery] = useState('');
  const [groupOpen, setGroupOpen] = useState(false);
  const normalized = query.trim().toLowerCase();

  const filteredConversations = useMemo(() => (
    conversations.filter((conversation) => conversationTitle(conversation, state.me.userId, allUsers).toLowerCase().includes(normalized))
  ), [allUsers, conversations, normalized, state.me.userId]);

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

  return (
    <>
      <Sidebar ariaLabel="Conversas" className="text-text-primary" panelClassName="bg-bg-primary">
        <div className="flex h-full min-h-0">
          {/* on a phone the rail lives in the drawer; from 768px it stays on screen beside it */}
          {isMobile && mobileRail}
          <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex flex-none items-center gap-2 px-4 py-4">
              <h1 className="min-w-0 flex-1 truncate text-title font-semibold">Conversas</h1>
              <Button type="button" size="icon-sm" aria-label="Criar grupo" onClick={() => setGroupOpen(true)} className="flex-none">
                <Plus size={16} />
              </Button>
              <NotificationBell onNavigate={() => { if (isOverlay) setOpenMobile(false); }} />
              {!isOverlay && (
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Ocultar lista de conversas" onClick={toggleSidebar} className="flex-none text-text-muted hover:text-text-primary">
                  <PanelLeftClose size={16} />
                </Button>
              )}
            </div>

            {/* as a column, the gap to the content is the content card's own margin, which stays when the list is hidden */}
            <div className="flex min-h-0 flex-1 flex-col gap-3 pb-3 pl-3 pr-shell lg:pr-0">
              <div className="flex flex-none items-center gap-2 rounded-md border border-border bg-fill-subtle px-3">
                <Search size={15} className="text-text-muted" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Buscar conversas"
                  className="h-10 min-w-0 flex-1 bg-transparent text-label outline-none placeholder:text-text-muted"
                />
                <button
                  type="button"
                  onClick={onOpenPalette}
                  aria-label={`Abrir busca rápida (${shortcutK})`}
                  className="flex-none rounded-sm border border-border bg-black/20 px-1.5 py-0.5 text-micro font-medium text-text-muted transition-colors hover:text-text-secondary"
                >
                  {shortcutK}
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="flex flex-col gap-1">
                  {filteredConversations.length === 0 ? (
                    <p className="px-3 py-8 text-center text-label text-text-muted">Nenhuma conversa.</p>
                  ) : filteredConversations.map((conversation) => (
                    <ConversationRow
                      key={conversation.id}
                      conversation={conversation}
                      active={onConversations && conversation.id === activeConversationId}
                      onClick={() => selectConversation(conversation.id)}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </Sidebar>
      <GroupCreateDialog
        open={groupOpen}
        onOpenChange={setGroupOpen}
        onCreated={() => { if (isOverlay) setOpenMobile(false); }}
      />
    </>
  );
}
