import { GearIcon, MicrophoneIcon, MicrophoneSlashIcon, MonitorIcon, PhoneIcon, PhoneSlashIcon, SpeakerHighIcon, SpeakerSlashIcon, VideoCameraIcon, VideoCameraSlashIcon } from '@phosphor-icons/react';
import { Link, useLocation } from 'react-router';
import { iconWeight } from '@/shared/ui/icons';
import { Avatar } from '@/shared/Avatar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/primitives/tooltip';
import { useRoom } from '@/state/RoomContext';
import { conversationTitle } from '@/features/conversations/conversationUtils';
import { useParticipantMedia } from './useLiveKitTrack';
import { cn } from '@/shared/lib/utils';
import { ROUTES } from '@/shared/lib/routes';

const MIC_PROBLEM_LABEL = {
  'not-found': 'Nenhum microfone encontrado',
  denied: 'Microfone bloqueado pelo navegador',
  unavailable: 'Microfone indisponível',
} as const;

const DOCK_BUTTON = 'grid size-9 flex-none place-items-center rounded-md transition-colors';
const DOCK_NEUTRAL = 'text-text-secondary hover:bg-fill-hover hover:text-text-primary';
const DOCK_RED = 'bg-red/16 text-red hover:bg-red/24';
const DOCK_GREEN = 'bg-green-solid text-white hover:bg-green-hover';
const CALL_JOIN = 'flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-green-solid text-label font-semibold text-white transition-colors hover:bg-green-hover';

interface CallDockProps {
  onReturnToCall: () => void;
  onOpenProfile: (userId: string) => void;
  /** False while the stage is already on screen, no point offering a way back. */
  showReturnToCall: boolean;
  /** wide: one row with the name, across the rail and the list; compact: a
   * column of icons, for when only the rail is on screen */
  layout?: 'wide' | 'compact';
  /** a navigation from the dock (settings) — the drawer closes itself on it */
  onNavigate?: () => void;
}

export function CallDock({ onReturnToCall, onOpenProfile, showReturnToCall, layout = 'wide', onNavigate }: CallDockProps) {
  const {
    state, conversations, allUsers, activeCallConversationId,
    startCamera, stopCamera, startSharing, stopSharing, activateMic, toggleMicMuted,
    deafened, toggleDeafened, leaveCall, preferMuted, setPreferMuted, reconnecting,
  } = useRoom();
  const { pathname } = useLocation();
  const compact = layout === 'compact';
  const onSettings = pathname.startsWith(ROUTES.settings);
  const inCall = !!activeCallConversationId;
  const myMedia = useParticipantMedia(state.me.id ?? '');
  const cameraOn = state.me.cameraOn;
  const sharing = state.me.sharing;
  const micProblem = myMedia.micActivated ? null : state.micProblem;
  const micLabel = inCall
    ? (micProblem ? MIC_PROBLEM_LABEL[micProblem] : !myMedia.micActivated ? 'Ativar microfone' : myMedia.micMuted ? 'Desmutar' : 'Mutar')
    : preferMuted ? 'Desmutar' : 'Mutar';
  const micMuted = inCall ? (myMedia.micMuted || !!micProblem) : preferMuted;
  const title = conversationTitle(
    conversations.find((conversation) => conversation.id === activeCallConversationId) ?? null,
    state.me.userId,
    allUsers,
  );

  function onMic() {
    if (!inCall) {
      setPreferMuted(!preferMuted);
      return;
    }
    if (myMedia.micActivated) {
      setPreferMuted(!myMedia.micMuted);
      void toggleMicMuted();
      return;
    }
    void activateMic();
  }

  const returnButton = inCall && showReturnToCall && (
    compact ? (
      <Tooltip>
        <TooltipTrigger onClick={onReturnToCall} aria-label="Voltar à chamada" className={cn(DOCK_BUTTON, DOCK_GREEN)}>
          <PhoneIcon size={20} weight="fill" />
        </TooltipTrigger>
        <TooltipContent side="right">Voltar à chamada</TooltipContent>
      </Tooltip>
    ) : (
      <button type="button" onClick={onReturnToCall} className={CALL_JOIN}>
        <PhoneIcon size={20} weight="fill" />
        Voltar à chamada
      </button>
    )
  );
  const leaveButton = (
    <Tooltip>
      <TooltipTrigger
        onClick={() => void leaveCall()}
        aria-label="Sair da chamada"
        className={cn(DOCK_BUTTON, 'bg-red text-white hover:bg-red-hover')}
      >
        <PhoneSlashIcon size={20} weight="fill" />
      </TooltipTrigger>
      <TooltipContent side={compact ? 'right' : 'top'}>Sair da chamada</TooltipContent>
    </Tooltip>
  );
  const tipSide = compact ? 'right' : 'top';

  return (
    <div className={cn(
      'flex flex-col gap-2 rounded-xl border border-border bg-bg-secondary shadow-panel',
      // the compact card is 48px wide: its buttons only fit with a thinner edge
      compact ? 'items-center p-1' : 'p-2',
    )}>
      {inCall && (compact ? (
        <div className="flex flex-col items-center gap-1">
          {returnButton}
          {leaveButton}
        </div>
      ) : (
        <div className="flex flex-col gap-2 px-0.5 pt-0.5">
          {returnButton}
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-caption font-semibold text-green">Em chamada</p>
              <p className="truncate text-label font-semibold text-text-primary">{title}</p>
            </div>
            {leaveButton}
          </div>
        </div>
      ))}
      <div className={cn('flex items-center gap-1', compact ? 'flex-col' : 'px-0.5')}>
        <button
          type="button"
          onClick={() => { if (state.me.userId) onOpenProfile(state.me.userId); }}
          aria-label="Meu perfil"
          className={cn(
            'flex items-center gap-2 rounded-md text-left transition-colors hover:bg-fill-hover',
            compact ? 'p-0.5' : 'min-w-0 flex-1 px-1 py-0.5',
          )}
        >
          <span className="relative flex-none">
            <Avatar id={state.me.userId ?? state.me.id ?? 'me'} name={state.me.displayName} avatar={state.me.avatar} avatarColor={state.me.avatarColor} size={36} />
            {/* you are online while this is on screen; gray while the connection is being re-established */}
            <span aria-hidden data-status={reconnecting ? 'reconnecting' : 'online'} className={cn('absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full border-2 border-bg-secondary', reconnecting ? 'bg-text-muted' : 'bg-green')} />
          </span>
          {!compact && <span className="min-w-0 truncate text-label font-semibold text-text-primary">{state.me.displayName}</span>}
        </button>
        <Tooltip>
          <TooltipTrigger
            onClick={onMic}
            aria-label={micLabel}
            className={cn(DOCK_BUTTON, micMuted ? DOCK_RED : DOCK_NEUTRAL)}
          >
            {micMuted ? <MicrophoneSlashIcon size={20} weight={iconWeight(true)} /> : <MicrophoneIcon size={20} />}
          </TooltipTrigger>
          <TooltipContent side={tipSide}>{micLabel}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            onClick={toggleDeafened}
            aria-label={deafened ? 'Voltar a ouvir' : 'Parar de ouvir'}
            className={cn(DOCK_BUTTON, deafened ? DOCK_RED : DOCK_NEUTRAL)}
          >
            {deafened ? <SpeakerSlashIcon size={20} weight={iconWeight(true)} /> : <SpeakerHighIcon size={20} />}
          </TooltipTrigger>
          <TooltipContent side={tipSide}>{deafened ? 'Voltar a ouvir' : 'Parar de ouvir'}</TooltipContent>
        </Tooltip>
        {inCall && (
          <>
            <Tooltip>
              <TooltipTrigger
                onClick={() => { void (cameraOn ? stopCamera() : startCamera()); }}
                aria-label={cameraOn ? 'Parar câmera' : 'Ligar câmera'}
                className={cn(DOCK_BUTTON, cameraOn ? DOCK_GREEN : DOCK_NEUTRAL)}
              >
                {cameraOn ? <VideoCameraIcon size={20} weight={iconWeight(true)} /> : <VideoCameraSlashIcon size={20} />}
              </TooltipTrigger>
              <TooltipContent side={tipSide}>{cameraOn ? 'Parar câmera' : 'Ligar câmera'}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                onClick={() => { void (sharing ? stopSharing() : startSharing()); }}
                aria-label={sharing ? 'Parar compartilhamento' : 'Compartilhar tela'}
                className={cn(DOCK_BUTTON, sharing ? DOCK_GREEN : DOCK_NEUTRAL)}
              >
                <MonitorIcon size={20} weight={iconWeight(sharing)} />
              </TooltipTrigger>
              <TooltipContent side={tipSide}>{sharing ? 'Parar compartilhamento' : 'Compartilhar tela'}</TooltipContent>
            </Tooltip>
          </>
        )}
        <Tooltip>
          <TooltipTrigger
            render={<Link to={ROUTES.settings} onClick={onNavigate} aria-current={onSettings ? 'page' : undefined} aria-label="Ajustes" />}
            className={cn(DOCK_BUTTON, onSettings ? 'bg-fill-active text-text-primary' : DOCK_NEUTRAL)}
          >
            <GearIcon size={20} weight={iconWeight(onSettings)} aria-hidden />
          </TooltipTrigger>
          <TooltipContent side={tipSide}>Ajustes</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
