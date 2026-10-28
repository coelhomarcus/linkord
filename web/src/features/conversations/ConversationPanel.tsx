import { ArrowLeftIcon, ImageIcon, InfoIcon, MagnifyingGlassIcon, PhoneIcon } from '@phosphor-icons/react';

import { PageHeader } from '@/shared/PageHeader';
import { useSidebar } from '@/shared/ui/motion/sidebar-context';
import { Button } from '@/shared/ui/primitives/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/primitives/tooltip';
import { Avatar } from '@/shared/Avatar';
import { useRoom } from '@/state/RoomContext';
import { formatLastSeen } from '@/shared/lib/formatLastSeen';
import { conversationTitle, directUser, groupMembers } from './conversationUtils';
import { GroupAvatar } from './GroupAvatar';
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

export function ConversationPanel({ onOpenProfile, onOpenCall, onOpenSearch, detailsOpen, mediaOpen, onOpenDetails, onToggleDetails, onToggleMedia }: ConversationPanelProps) {
  const { state, dispatch, conversations, activeConversationId, allUsers, onlineUserIds, activeCallConversationId } = useRoom();
  const { setOpenMobile } = useSidebar();
  const conversation = conversations.find((item) => item.id === activeConversationId) ?? null;
  const isBot = conversation?.type === 'bot';
  const hasDetails = conversation?.type === 'group' || isBot;
  const title = conversationTitle(conversation, state.me.userId, allUsers);
  const other = directUser(conversation, state.me.userId, allUsers);
  const members = groupMembers(conversation, allUsers);
  const online = other ? onlineUserIds.has(other.id) : false;
  const subtitle = hasDetails
    ? `${members.length} ${members.length === 1 ? 'membro' : 'membros'}`
    : other ? (online ? 'Online' : formatLastSeen(other.lastSeenAt)) : '';
  // `state.participants` only ever holds OTHER people (the server excludes
  // yourself from it) — my own row in this list has to come from `state.me`
  // instead, gated on whether I'm actually the one in this call.
  const otherCallParticipants = [...state.participants.values()].filter((p) => p.callConversationId === conversation?.id);
  const callParticipants = conversation && activeCallConversationId === conversation.id
    ? [{ id: state.me.userId ?? 'me', displayName: state.me.displayName, avatar: state.me.avatar, avatarColor: state.me.avatarColor }, ...otherCallParticipants]
    : otherCallParticipants;
  const directPeerId = conversation?.type === 'direct' ? (conversation.memberIds.find((id) => id !== state.me.userId) ?? null) : null;
  const { state: relationship } = useRelationship(directPeerId);
  // Same stance as DirectComposerGate: only a confirmed answer disables the
  // button — while loading (or on a failed read) the server's own check decides.
  const callBlockedReason = conversation?.status === 'suspended'
    ? null
    : relationship.status === 'ready' && relationship.value.relation === 'blocked'
      ? 'Você não pode ligar enquanto essa pessoa estiver bloqueada.'
      : relationship.status === 'ready' && relationship.value.relation !== 'friends'
        ? 'Vocês precisam ser amigos para fazer chamadas.'
        : null;
  const callJoinError = state.callJoinError && state.callJoinError.conversationId === conversation?.id ? state.callJoinError.message : null;
  const inThisCall = !!conversation && activeCallConversationId === conversation.id;
  const callActionLabel = inThisCall ? 'Voltar à chamada' : 'Entrar na chamada';

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col text-text-primary">
      {conversation ? (
        <>
          <header className="flex h-header flex-none items-center gap-3 border-b border-border bg-surface-panel/90 px-4 backdrop-blur">
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Voltar" onClick={() => setOpenMobile(true)} className="-ml-1 md:hidden">
              <ArrowLeftIcon size={20} />
            </Button>
            {conversation.type === 'direct' && other ? (
              <button
                type="button"
                onClick={() => onOpenProfile(other.id)}
                className="transition-opacity hover:opacity-80"
                aria-label="Ver perfil"
              >
                <Avatar id={other.id} name={other.displayName} avatar={other.avatar} avatarColor={other.avatarColor} size={40} />
              </button>
            ) : (
              <button
                type="button"
                onClick={onOpenDetails}
                className="transition-colors hover:border-border-strong"
                aria-label={isBot ? 'Detalhes do bot' : 'Detalhes do grupo'}
              >
                <GroupAvatar id={conversation.id} title={title} avatar={conversation.avatar} size={40} />
              </button>
            )}
            <button
              type="button"
              onClick={hasDetails ? onOpenDetails : (other ? () => onOpenProfile(other.id) : undefined)}
              className="min-w-0 flex-1 text-left"
            >
              <h2 className="truncate text-title font-semibold">{title}</h2>
              {subtitle && <p className="truncate text-caption text-text-muted">{subtitle}</p>}
            </button>
            {callParticipants.length > 0 && (
              <Tooltip>
                <TooltipTrigger render={<div className="flex flex-none items-center -space-x-2" />}>
                  {callParticipants.slice(0, 4).map((p) => (
                    <Avatar key={p.id} id={p.id} name={p.displayName} avatar={p.avatar} avatarColor={p.avatarColor} size={28} className="ring-2 ring-surface-panel" />
                  ))}
                  {callParticipants.length > 4 && (
                    <span className="grid size-7 place-items-center rounded-full bg-bg-tertiary text-micro font-semibold text-text-secondary ring-2 ring-surface-panel">
                      +{callParticipants.length - 4}
                    </span>
                  )}
                </TooltipTrigger>
                <TooltipContent side="bottom">Na chamada</TooltipContent>
              </Tooltip>
            )}
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Mídias e links" aria-pressed={mediaOpen} onClick={onToggleMedia} className={panelToggleClass(mediaOpen)}>
              <ImageIcon size={20} />
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Buscar mensagens" onClick={onOpenSearch} className="text-text-muted hover:text-text-primary">
              <MagnifyingGlassIcon size={20} />
            </Button>
            {hasDetails && (
              <Button type="button" variant="ghost" size="icon-sm" aria-label={isBot ? 'Detalhes do bot' : 'Detalhes do grupo'} aria-pressed={detailsOpen} onClick={onToggleDetails} className={panelToggleClass(detailsOpen)}>
                <InfoIcon size={20} />
              </Button>
            )}
            {/* a bot has nobody to call */}
            {isBot ? null : callBlockedReason ? (
              <Tooltip>
                {/* a disabled button gets no pointer events, so the tooltip hangs off a wrapper */}
                <TooltipTrigger render={<span tabIndex={0} className="inline-flex rounded-md focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50" />}>
                  <Button type="button" size="sm" disabled className="bg-bg-tertiary text-text-muted">
                    <PhoneIcon size={20} weight="fill" />
                    Entrar na chamada
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{callBlockedReason}</TooltipContent>
              </Tooltip>
            ) : (
              <Button type="button" size="sm" disabled={conversation.status === 'suspended'} onClick={() => onOpenCall(conversation.id)} className="bg-green-solid text-white hover:bg-green-hover">
                <PhoneIcon size={20} weight="fill" />
                {callActionLabel}
              </Button>
            )}
          </header>
          {callJoinError && (
            <div role="alert" className="mx-3 mt-3 flex items-start gap-2 rounded-md border border-red/40 bg-bg-floating px-3 py-2 text-label text-text-secondary shadow-popover md:mx-4">
              <PhoneIcon size={20} className="mt-0.5 flex-none text-red" />
              <span className="min-w-0 flex-1">{callJoinError}</span>
              <CloseButton size="xs" label="Dispensar aviso" onClick={() => dispatch({ type: 'SET_CALL_JOIN_ERROR', error: null })} />
            </div>
          )}
          {conversation.status === 'suspended' ? (
              <div role="status" className="grid flex-1 place-items-center px-6 text-center">
                <div>
                  <p className="text-title font-semibold text-text-primary">{isBot ? 'Bot suspenso' : 'Grupo suspenso'}</p>
                  <p className="mt-1 max-w-sm text-label text-text-muted">{isBot ? 'A administração suspendeu este bot. Enquanto durar, ninguém lê os avisos e ele não recebe novos.' : 'A administração suspendeu este grupo. Enquanto durar, ninguém lê, escreve ou entra em chamada.'}</p>
                </div>
              </div>
            ) : (
              <ChatSurface conversationId={conversation.id} onOpenProfile={onOpenProfile} />
            )}
        </>
      ) : (
        <>
          {/* the header carries the button that reopens the drawer on a phone, where nothing else can */}
          <PageHeader title="Conversas" />
          <div className="grid flex-1 place-items-center px-6 text-center">
            <div>
              <p className="text-title font-semibold text-text-primary">Abra uma conversa</p>
              <p className="mt-1 text-label text-text-muted">Escolha uma pessoa, grupo ou bot na sidebar.</p>
            </div>
          </div>
        </>
      )}
    </main>
  );
}
