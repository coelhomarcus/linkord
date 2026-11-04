import { ArrowLeftIcon, DotsThreeIcon, HashIcon, ImageIcon, MagnifyingGlassIcon, PhoneIcon, UserCircleIcon, UsersThreeIcon } from '@phosphor-icons/react';
import { useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';

import { PageHeader } from '@/shared/PageHeader';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/ui/primitives/dropdown-menu';
import { ROUTES, conversationIdFromPath } from '@/shared/lib/routes';
import { useSidebar } from '@/shared/ui/motion/sidebar-context';
import { Button } from '@/shared/ui/primitives/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/primitives/tooltip';
import { Avatar } from '@/shared/Avatar';
import { useRoom } from '@/state/RoomContext';
import { formatLastSeen } from '@/shared/lib/formatLastSeen';
import { conversationTitle, directUser } from './conversationUtils';
import { ChatSurface } from '@/features/chat/ChatSurface';
import { useRelationship } from '@/features/friends/useRelationship';
import { CloseButton } from '@/shared/ui/primitives/close-button';

function panelToggleClass(open: boolean): string {
  return open ? 'bg-fill-active text-text-primary' : 'text-text-muted hover:text-text-primary';
}

interface ConversationPanelProps {
  onOpenProfile: (userId: string) => void;
  onOpenCall: (conversationId: string) => void;
  onOpenSearch: () => void;
  /** whether each right panel is showing, so its header button reads as pressed */
  detailsOpen: boolean;
  mediaOpen: boolean;
  /** the avatar and title: they only ever open the details */
  onOpenDetails: () => void;
  onToggleDetails: () => void;
  onToggleMedia: () => void;
}

export function ConversationPanel({ onOpenProfile, onOpenCall, onOpenSearch, detailsOpen, mediaOpen, onToggleDetails, onToggleMedia }: ConversationPanelProps) {
  const { t } = useTranslation('conversations');
  const { state, dispatch, conversations, activeConversationId, allUsers, onlineUserIds, activeCallConversationId } = useRoom();
  const navigate = useNavigate();
  const { pathname, state: locationState } = useLocation();
  const { isMobile } = useSidebar();
  const requestedId = conversationIdFromPath(pathname);
  // On a phone the bare list route hides this panel (display: none). Mounting
  // the active chat there let its timeline settle at zero height, and the
  // browser reset its scroll when it was shown, so it opened mid-history.
  const shownId = requestedId ?? (isMobile ? null : activeConversationId);
  const conversation = conversations.find((item) => item.id === shownId) ?? null;
  const isChannel = !!conversation?.serverId;
  // ConversationSidebar pushes every open with the route we came from in
  // state. Step back to that entry so the browser's back and forward (edge
  // swipes on a phone) and Voltar stay on the same history. With no prior
  // entry (a direct link), the list takes this one's place.
  function goBackToList() {
    if ((locationState as { from?: unknown } | null)?.from != null) navigate(-1);
    else navigate(conversation?.serverId ? ROUTES.server(conversation.serverId) : ROUTES.home, { replace: true });
  }
  const title = conversationTitle(conversation, state.me.userId, allUsers);
  const other = directUser(conversation, state.me.userId, allUsers);
  const online = other ? onlineUserIds.has(other.id) : false;
  const subtitle = isChannel
    ? conversation?.topic ?? ''
    : other ? (online ? t('panel.online') : formatLastSeen(other.lastSeenAt)) : '';
  // `state.participants` only ever holds OTHER people (the server excludes
  // yourself from it) — my own row in this list has to come from `state.me`
  // instead, gated on whether I'm actually the one in this call.
  const otherCallParticipants = [...state.participants.values()].filter((p) => p.callConversationId === conversation?.id);
  const callParticipants = conversation && activeCallConversationId === conversation.id
    ? [{ id: state.me.userId ?? 'me', displayName: state.me.displayName, avatar: state.me.avatar, avatarPoster: state.me.avatarPoster, avatarColor: state.me.avatarColor }, ...otherCallParticipants]
    : otherCallParticipants;
  const directPeerId = conversation?.type === 'direct' ? (conversation.memberIds.find((id) => id !== state.me.userId) ?? null) : null;
  const { state: relationship } = useRelationship(directPeerId);
  // Same stance as DirectComposerGate: only a confirmed answer disables the
  // button — while loading (or on a failed read) the server's own check decides.
  const callBlockedReason = relationship.status === 'ready' && relationship.value.relation === 'blocked'
      ? t('panel.blocked')
      : relationship.status === 'ready' && relationship.value.relation !== 'friends'
        ? t('panel.needFriends')
        : null;
  const callJoinError = state.callJoinError && state.callJoinError.conversationId === conversation?.id ? state.callJoinError.message : null;
  const inThisCall = !!conversation && activeCallConversationId === conversation.id;
  const callActionLabel = inThisCall ? t('panel.returnToCall') : t('panel.joinCall');
  const detailsLabel = t('panel.members');

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col text-text-primary">
      {conversation ? (
        <>
          <header data-avatar-hover className="flex h-header flex-none items-center gap-2 bg-surface-panel/90 px-2 backdrop-blur md:gap-3 md:border-b md:border-border md:px-4">
            <Button type="button" variant="ghost" size="icon" aria-label={t('panel.back')} onClick={goBackToList} className="md:hidden">
              <ArrowLeftIcon size={20} />
            </Button>
            {conversation.type === 'direct' && other ? (
              <button
                type="button"
                onClick={() => onOpenProfile(other.id)}
                className="transition-opacity hover:opacity-80"
                aria-label={t('panel.viewProfile')}
              >
                <Avatar id={other.id} name={other.displayName} avatar={other.avatar} poster={other.avatarPoster} animateOnHover avatarColor={other.avatarColor} size={40} />
              </button>
            ) : (
              <HashIcon size={24} className="flex-none text-text-muted" aria-hidden />
            )}
            {isChannel ? (
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <h2 className="flex-none truncate text-title font-semibold">{title}</h2>
                {subtitle && <span aria-hidden className="h-5 w-px flex-none bg-border max-md:hidden" />}
                {subtitle && <p className="min-w-0 truncate text-label text-text-muted max-md:hidden">{subtitle}</p>}
              </div>
            ) : (
              <button type="button" onClick={other ? () => onOpenProfile(other.id) : undefined} className="min-w-0 flex-1 text-left">
                <h2 className="truncate text-title font-semibold">{title}</h2>
                {subtitle && <p className="truncate text-caption text-text-muted">{subtitle}</p>}
              </button>
            )}
            {callParticipants.length > 0 && (
              <Tooltip>
                <TooltipTrigger render={<div className="hidden flex-none items-center -space-x-2 md:flex" />}>
                  {callParticipants.slice(0, 4).map((p) => (
                    <Avatar key={p.id} id={p.id} name={p.displayName} avatar={p.avatar} poster={p.avatarPoster} animateOnHover avatarColor={p.avatarColor} size={28} className="ring-2 ring-surface-panel" />
                  ))}
                  {callParticipants.length > 4 && (
                    <span className="grid size-7 place-items-center rounded-full bg-bg-tertiary text-micro font-semibold text-text-secondary ring-2 ring-surface-panel">
                      +{callParticipants.length - 4}
                    </span>
                  )}
                </TooltipTrigger>
                <TooltipContent side="bottom">{t('panel.inCall')}</TooltipContent>
              </Tooltip>
            )}
            <Button type="button" variant="ghost" size="icon-sm" aria-label={t('panel.media')} aria-pressed={mediaOpen} onClick={onToggleMedia} className={`${panelToggleClass(mediaOpen)} max-md:hidden`}>
              <ImageIcon size={20} />
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={t('panel.search')} onClick={onOpenSearch} className="text-text-muted hover:text-text-primary max-md:hidden">
              <MagnifyingGlassIcon size={20} />
            </Button>
            {isChannel ? (
              <Button type="button" variant="ghost" size="icon-sm" aria-label={detailsLabel} aria-pressed={detailsOpen} onClick={onToggleDetails} className={panelToggleClass(detailsOpen)}>
                <UsersThreeIcon size={22} weight={detailsOpen ? 'fill' : 'regular'} />
              </Button>
            ) : other && (
              // the DM profile panel only fits beside the chat on wide screens
              <Button type="button" variant="ghost" size="icon-sm" aria-label={t('panel.profile')} aria-pressed={detailsOpen} onClick={onToggleDetails} className={`${panelToggleClass(detailsOpen)} max-xl:hidden`}>
                <UserCircleIcon size={22} weight={detailsOpen ? 'fill' : 'regular'} />
              </Button>
            )}
            {/* calls in a server happen in its voice channels */}
            {isChannel ? null : callBlockedReason ? (
              <Tooltip>
                {/* a disabled button gets no pointer events, so the tooltip hangs off a wrapper */}
                <TooltipTrigger render={<span tabIndex={0} className="inline-flex rounded-md focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50" />}>
                  <Button type="button" size="sm" disabled className="bg-bg-tertiary text-text-muted max-md:hidden">
                    <PhoneIcon size={20} weight="fill" />
                    {t('panel.joinCall')}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{callBlockedReason}</TooltipContent>
              </Tooltip>
            ) : (
              <Button type="button" size="sm" onClick={() => onOpenCall(conversation.id)} className="bg-green-solid text-white hover:bg-green-hover max-md:hidden">
                <PhoneIcon size={20} weight="fill" />
                {callActionLabel}
              </Button>
            )}
            {(activeCallConversationId || !isChannel) && <Button type="button" variant="ghost" size="icon" aria-label={activeCallConversationId && activeCallConversationId !== conversation.id ? t('panel.returnToActiveCall') : callBlockedReason ?? callActionLabel} disabled={!activeCallConversationId && !!callBlockedReason} onClick={() => onOpenCall(activeCallConversationId ?? conversation.id)} className="flex-none text-green md:hidden"><PhoneIcon size={22} weight="fill" /></Button>}
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon" aria-label={t('panel.moreOptions')} className="flex-none md:hidden" />}><DotsThreeIcon size={22} /></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onOpenSearch}><MagnifyingGlassIcon size={18} />{t('panel.search')}</DropdownMenuItem>
                <DropdownMenuItem onClick={onToggleMedia}><ImageIcon size={18} />{t('panel.media')}</DropdownMenuItem>
                {activeCallConversationId && activeCallConversationId !== conversation.id && !isChannel && <DropdownMenuItem disabled={!!callBlockedReason} onClick={() => onOpenCall(conversation.id)}><PhoneIcon size={18} />{t('panel.joinThisCall')}</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
          </header>
          {callJoinError && (
            <div role="alert" className="mx-3 mt-3 flex items-start gap-2 rounded-md border border-red/40 bg-bg-floating px-3 py-2 text-label text-text-secondary shadow-popover md:mx-4">
              <PhoneIcon size={20} className="mt-0.5 flex-none text-red" />
              <span className="min-w-0 flex-1">{callJoinError}</span>
              <CloseButton size="xs" label={t('panel.dismissNotice')} onClick={() => dispatch({ type: 'SET_CALL_JOIN_ERROR', error: null })} />
            </div>
          )}
          <ChatSurface conversationId={conversation.id} onOpenProfile={onOpenProfile} />
        </>
      ) : (
        <>
          <PageHeader title={t('sidebar.directMessages')} />
          <div className="grid flex-1 select-none place-items-center px-6 text-center">
            <div>
              <p className="text-title font-semibold text-text-primary">{t('panel.emptyTitle')}</p>
              <p className="mt-1 text-label text-text-muted">{t('panel.emptyText')}</p>
            </div>
          </div>
        </>
      )}
    </main>
  );
}
