import { EarSlashIcon, HeadphonesIcon, MicrophoneIcon, MicrophoneSlashIcon, MonitorIcon, PhoneDisconnectIcon, PhoneIcon, ScreencastIcon, VideoCameraIcon, VideoCameraSlashIcon } from '@phosphor-icons/react';
import { iconWeight } from '@/shared/ui/icons';
import { Avatar } from '@/shared/Avatar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/primitives/tooltip';
import { useRoom } from '@/state/RoomContext';
import { conversationTitle } from '@/features/conversations/conversationUtils';
import { useParticipantMedia } from './useLiveKitTrack';
import { cn } from '@/shared/lib/utils';

const MIC_PROBLEM_LABEL = {
  'not-found': 'Nenhum microfone encontrado',
  denied: 'Microfone bloqueado pelo navegador',
  unavailable: 'Microfone indisponível',
} as const;

const DOCK_BUTTON = 'grid size-8 flex-none place-items-center rounded-md transition-colors';
const DOCK_NEUTRAL = 'text-text-secondary hover:bg-fill-hover hover:text-text-primary';
const DOCK_RED = 'bg-red/16 text-red hover:bg-red/24';
const DOCK_GREEN = 'bg-green/16 text-green hover:bg-green/24';

interface CallDockProps {
  onReturnToCall: () => void;
  onOpenProfile: (userId: string) => void;
  /** False while the stage is already on screen — no point offering a way back. */
  showReturnToCall: boolean;
}

export function CallDock({ onReturnToCall, onOpenProfile, showReturnToCall }: CallDockProps) {
  const {
    state, conversations, allUsers, activeCallConversationId,
    startCamera, stopCamera, startSharing, stopSharing, activateMic, toggleMicMuted,
    deafened, toggleDeafened, leaveCall, preferMuted, setPreferMuted,
  } = useRoom();
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

  return (
    <div className="flex flex-none flex-col gap-2 border-t border-border pt-3">
      {inCall && (
        <div className="flex flex-col gap-2 px-1">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-caption font-semibold text-green">Em chamada</p>
              <p className="truncate text-label font-semibold text-text-primary">{title}</p>
            </div>
            <Tooltip>
              <TooltipTrigger
                onClick={() => void leaveCall()}
                aria-label="Sair da chamada"
                className={cn(DOCK_BUTTON, 'bg-red text-white hover:bg-red-hover')}
              >
                <PhoneDisconnectIcon size={16} />
              </TooltipTrigger>
              <TooltipContent>Sair da chamada</TooltipContent>
            </Tooltip>
          </div>
          {showReturnToCall && (
            <button
              type="button"
              onClick={onReturnToCall}
              className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-green/16 text-label font-semibold text-green transition-colors hover:bg-green/24"
            >
              <PhoneIcon size={14} />
              Voltar à chamada
            </button>
          )}
        </div>
      )}
      <div className="flex items-center gap-1 px-1">
        <button
          type="button"
          onClick={() => { if (state.me.userId) onOpenProfile(state.me.userId); }}
          aria-label="Meu perfil"
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-fill-hover"
        >
          <Avatar id={state.me.userId ?? state.me.id ?? 'me'} name={state.me.displayName} avatar={state.me.avatar} avatarColor={state.me.avatarColor} size={32} />
          <span className="min-w-0 truncate text-label font-semibold text-text-primary">{state.me.displayName}</span>
        </button>
        <Tooltip>
          <TooltipTrigger
            onClick={onMic}
            aria-label={micLabel}
            className={cn(DOCK_BUTTON, micMuted ? DOCK_RED : DOCK_NEUTRAL)}
          >
            {micMuted ? <MicrophoneSlashIcon size={16} weight={iconWeight(true)} /> : <MicrophoneIcon size={16} />}
          </TooltipTrigger>
          <TooltipContent>{micLabel}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            onClick={toggleDeafened}
            aria-label={deafened ? 'Voltar a ouvir' : 'Parar de ouvir'}
            className={cn(DOCK_BUTTON, deafened ? DOCK_RED : DOCK_NEUTRAL)}
          >
            {deafened ? <EarSlashIcon size={16} weight={iconWeight(true)} /> : <HeadphonesIcon size={16} />}
          </TooltipTrigger>
          <TooltipContent>{deafened ? 'Voltar a ouvir' : 'Parar de ouvir'}</TooltipContent>
        </Tooltip>
        {inCall && (
          <>
            <Tooltip>
              <TooltipTrigger
                onClick={() => { void (cameraOn ? stopCamera() : startCamera()); }}
                aria-label={cameraOn ? 'Parar câmera' : 'Ligar câmera'}
                className={cn(DOCK_BUTTON, cameraOn ? DOCK_GREEN : DOCK_NEUTRAL)}
              >
                {cameraOn ? <VideoCameraIcon size={16} weight={iconWeight(true)} /> : <VideoCameraSlashIcon size={16} />}
              </TooltipTrigger>
              <TooltipContent>{cameraOn ? 'Parar câmera' : 'Ligar câmera'}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                onClick={() => { void (sharing ? stopSharing() : startSharing()); }}
                aria-label={sharing ? 'Parar compartilhamento' : 'Compartilhar tela'}
                className={cn(DOCK_BUTTON, sharing ? DOCK_GREEN : DOCK_NEUTRAL)}
              >
                {sharing ? <ScreencastIcon size={16} weight={iconWeight(true)} /> : <MonitorIcon size={16} />}
              </TooltipTrigger>
              <TooltipContent>{sharing ? 'Parar compartilhamento' : 'Compartilhar tela'}</TooltipContent>
            </Tooltip>
          </>
        )}
      </div>
    </div>
  );
}
