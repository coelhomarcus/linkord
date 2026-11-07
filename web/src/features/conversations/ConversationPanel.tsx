import { ArrowLeftIcon, DotsThreeIcon, HashIcon, ImageIcon, MagnifyingGlassIcon, PhoneIcon, UserCircleIcon, UsersThreeIcon, VideoCameraIcon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
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
import { callParticipantIds, conversationTitle, directUser } from './conversationUtils';
import { ChatSurface } from '@/features/chat/ChatSurface';
import { DmCallPane } from '@/features/calls/DmCallPane';
import { useRelationship } from '@/features/friends/useRelationship';
import { CloseButton } from '@/shared/ui/primitives/close-button';
import { cn } from '@/shared/lib/utils';

// Discord's header icons: bare 24px glyphs, gray at rest, white while hovered
// or while the panel they toggle is open
const HEADER_ICON = 'grid size-8 flex-none place-items-center rounded-lg text-text-secondary transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:text-text-strong';

function HeaderIcon({ label, pressed, onClick, className, children }: { label: string; pressed?: boolean; onClick: () => void; className?: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger onClick={onClick} aria-label={label} aria-pressed={pressed} className={cn(HEADER_ICON, className)}>
        {children}
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
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
  const { state, dispatch, conversations, activeConversationId, allUsers, onlineUserIds, activeCallConversationId, startDmCall } = useRoom();
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
  // a DM's presence lives on the profile (side panel and modal), not here
  const subtitle = isChannel ? conversation?.topic ?? '' : '';
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
  const inThisDmCall = conversation?.type === 'direct' && activeCallConversationId === conversation.id;
  const callActionLabel = inThisCall ? t('panel.returnToCall') : t('panel.voiceCall');
  const dmCallIds = inThisDmCall && conversation ? callParticipantIds(state.me.id, state.participants, conversation.id) : [];
  const dmCallPeers = dmCallIds.map((id) => {
    if (id === state.me.id) return { id, name: state.me.displayName, avatar: state.me.avatar, avatarPoster: state.me.avatarPoster, avatarColor: state.me.avatarColor };
    const participant = state.participants.get(id);
    return { id, name: participant?.displayName ?? '', avatar: participant?.avatar ?? '', avatarPoster: participant?.avatarPoster, avatarColor: participant?.avatarColor ?? '' };
  });
  function startThisCall(video: boolean) {
    if (!conversation || inThisCall) return;
    startDmCall(conversation.id, video);
  }
  const detailsLabel = t('panel.members');

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col text-text-primary">
      {conversation ? (
        <>
          <header data-avatar-hover className="flex h-header flex-none items-center gap-2 bg-surface-panel px-2 md:border-b md:border-border-subtle md:px-4">
            <Button type="button" variant="ghost" size="icon" aria-label={t('panel.back')} onClick={goBackToList} className="md:hidden">
              <ArrowLeftIcon size={20} />
            </Button>
            {conversation.type === 'direct' && other ? (
              <button
                type="button"
                onClick={() => onOpenProfile(other.id)}
                className="relative flex-none transition-opacity hover:opacity-80"
                aria-label={t('panel.viewProfile')}
              >
                <Avatar id={other.id} name={other.displayName} avatar={other.avatar} poster={other.avatarPoster} animateOnHover avatarColor={other.avatarColor} size={24} />
                <span aria-hidden className={cn('absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-surface-panel', online ? 'bg-green' : 'bg-text-muted')} />
              </button>
            ) : (
              <HashIcon size={24} className="flex-none text-text-muted" aria-hidden />
            )}
            <div className="flex min-w-0 flex-1 items-center gap-2">
              {isChannel ? (
                <h2 className="flex-none truncate text-body font-semibold text-text-strong">{title}</h2>
              ) : (
                <button type="button" onClick={other ? () => onOpenProfile(other.id) : undefined} className="min-w-0 flex-none truncate text-left text-body font-semibold text-text-strong">
                  <h2 className="truncate">{title}</h2>
                </button>
              )}
              {inThisDmCall && (
                <p className="flex min-w-0 items-center gap-1 truncate text-label text-green">
                  <PhoneIcon size={14} weight="fill" className="flex-none" />
                  {t('panel.inThisCall')}
                </p>
              )}
              {!inThisDmCall && subtitle && <span aria-hidden className="mx-1 h-6 w-px flex-none bg-border-default max-md:hidden" />}
              {!inThisDmCall && subtitle && <p className="min-w-0 truncate text-label text-text-secondary max-md:hidden">{subtitle}</p>}
            </div>
            {callParticipants.length > 0 && (
              <Tooltip>
                <TooltipTrigger render={<div className="hidden flex-none items-center -space-x-2 md:flex" />}>
                  {callParticipants.slice(0, 4).map((p) => (
                    <Avatar key={p.id} id={p.id} name={p.displayName} avatar={p.avatar} poster={p.avatarPoster} animateOnHover avatarColor={p.avatarColor} size={24} className="ring-2 ring-surface-panel" />
                  ))}
                  {callParticipants.length > 4 && (
                    <span className="grid size-6 place-items-center rounded-full bg-bg-tertiary text-micro font-semibold text-text-secondary ring-2 ring-surface-panel">
                      +{callParticipants.length - 4}
                    </span>
                  )}
                </TooltipTrigger>
                <TooltipContent side="bottom">{t('panel.inCall')}</TooltipContent>
              </Tooltip>
            )}
            <div className="flex flex-none items-center gap-2">
              {/* calls in a server happen in its voice channels */}
              {isChannel ? null : callBlockedReason ? (
                <Tooltip>
                  {/* a disabled button gets no pointer events, so the tooltip hangs off a wrapper */}
                  <TooltipTrigger render={<span tabIndex={0} className="inline-flex rounded-lg focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 max-md:hidden" />}>
                    <button type="button" disabled aria-label={t('panel.voiceCall')} className={cn(HEADER_ICON, 'opacity-40')}>
                      <PhoneIcon size={24} weight="fill" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{callBlockedReason}</TooltipContent>
                </Tooltip>
              ) : (
                <>
                  <HeaderIcon label={callActionLabel} onClick={() => startThisCall(false)} className={cn('max-md:hidden', inThisCall && 'text-green hover:text-green')}>
                    <PhoneIcon size={24} weight="fill" />
                  </HeaderIcon>
                  {!inThisCall && (
                    <HeaderIcon label={t('panel.videoCall')} onClick={() => startThisCall(true)} className="max-md:hidden">
                      <VideoCameraIcon size={24} weight="fill" />
                    </HeaderIcon>
                  )}
                </>
              )}
              <HeaderIcon label={t('panel.media')} pressed={mediaOpen} onClick={onToggleMedia} className="max-md:hidden">
                <ImageIcon size={24} weight={mediaOpen ? 'fill' : 'regular'} />
              </HeaderIcon>
              {isChannel ? (
                <HeaderIcon label={detailsLabel} pressed={detailsOpen} onClick={onToggleDetails}>
                  <UsersThreeIcon size={24} weight="fill" />
                </HeaderIcon>
              ) : other && (
                // the DM profile panel only fits beside the chat on wide screens
                <HeaderIcon label={t('panel.profile')} pressed={detailsOpen} onClick={onToggleDetails} className="max-xl:hidden">
                  <UserCircleIcon size={24} weight="fill" />
                </HeaderIcon>
              )}
              <HeaderIcon label={t('panel.search')} onClick={onOpenSearch} className="max-md:hidden">
                <MagnifyingGlassIcon size={24} />
              </HeaderIcon>
            </div>
            {(activeCallConversationId || !isChannel) && <Button type="button" variant="ghost" size="icon" aria-label={activeCallConversationId && activeCallConversationId !== conversation.id ? t('panel.returnToActiveCall') : callBlockedReason ?? callActionLabel} disabled={!activeCallConversationId && !!callBlockedReason} onClick={() => { if (activeCallConversationId && activeCallConversationId !== conversation.id) onOpenCall(activeCallConversationId); else startThisCall(false); }} className="flex-none text-green md:hidden"><PhoneIcon size={22} weight="fill" /></Button>}
            {!isChannel && !inThisCall && !callBlockedReason && !activeCallConversationId && <Button type="button" variant="ghost" size="icon" aria-label={t('panel.videoCall')} onClick={() => startThisCall(true)} className="flex-none md:hidden"><VideoCameraIcon size={22} weight="fill" /></Button>}
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon" aria-label={t('panel.moreOptions')} className="flex-none md:hidden" />}><DotsThreeIcon size={22} /></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onOpenSearch}><MagnifyingGlassIcon size={18} />{t('panel.search')}</DropdownMenuItem>
                <DropdownMenuItem onClick={onToggleMedia}><ImageIcon size={18} />{t('panel.media')}</DropdownMenuItem>
                {activeCallConversationId && activeCallConversationId !== conversation.id && !isChannel && <DropdownMenuItem disabled={!!callBlockedReason} onClick={() => startThisCall(false)}><PhoneIcon size={18} />{t('panel.voiceCall')}</DropdownMenuItem>}
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
          {inThisDmCall && (
            <DmCallPane participantIds={dmCallIds} peers={dmCallPeers} />
          )}
          <div className={inThisDmCall ? 'flex min-h-[220px] min-w-0 flex-1 flex-col' : 'contents'}>
            <ChatSurface conversationId={conversation.id} onOpenProfile={onOpenProfile} />
          </div>
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
