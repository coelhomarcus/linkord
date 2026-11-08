import { useEffect, useState } from 'react';
import { GearIcon, MicrophoneIcon, MicrophoneSlashIcon, MonitorIcon, PhoneSlashIcon, SpeakerHighIcon, SpeakerSlashIcon, VideoCameraIcon, VideoCameraSlashIcon } from '@phosphor-icons/react';
import { useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { iconWeight } from '@/shared/ui/icons';
import { Avatar } from '@/shared/Avatar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/primitives/tooltip';
import { useRoom } from '@/state/RoomContext';
import { conversationTitle } from '@/features/conversations/conversationUtils';
import { useParticipantMedia } from './useLiveKitTrack';
import { CallPingIndicator } from './CallPingIndicator';
import { cn } from '@/shared/lib/utils';
import { ROUTES } from '@/shared/lib/routes';
import { StatusMenu } from '@/features/status/StatusMenu';
import { StatusDot } from '@/features/status/StatusDot';
import { CustomStatusText } from '@/features/status/CustomStatusText';
import { useCustomStatus } from '@/features/status/statusDisplay';

const MIC_PROBLEM_LABEL_KEY = {
  'not-found': 'micProblem.notFoundLabel',
  denied: 'micProblem.deniedLabel',
  unavailable: 'micProblem.unavailableLabel',
} as const;

const DOCK_BUTTON = 'grid size-8 flex-none place-items-center rounded-lg transition-colors';
const DOCK_NEUTRAL = 'text-text-secondary hover:bg-fill-hover hover:text-text-primary';
const DOCK_RED = 'bg-red/12 text-red-text hover:bg-red/20';
const DOCK_GREEN = 'bg-green-solid text-white hover:bg-green-hover';

function formatCallDuration(startedAt: number, now: number): string {
  const total = Math.max(0, Math.floor((now - startedAt) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function useCallDuration(startedAt: number | null): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt == null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  if (startedAt == null) return null;
  return formatCallDuration(startedAt, now);
}

interface CallDockProps {
  /** the call's name, like Discord's channel line under "Voz conectada", leads back to it */
  onReturnToCall: () => void;
  onOpenProfile: (userId: string) => void;
  /** wide: one row with the name, across the rail and the list; compact: a
   * column of icons, for when only the rail is on screen */
  layout?: 'wide' | 'compact';
  /** a navigation from the dock (settings) — the drawer closes itself on it */
  onNavigate?: () => void;
}

/** A status change the server refused, shown in the dock for a few seconds. */
function useTransientError(ms = 5000) {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(null), ms);
    return () => window.clearTimeout(timer);
  }, [message, ms]);
  return [message, setMessage] as const;
}

export function CallDock({ onReturnToCall, onOpenProfile, layout = 'wide', onNavigate }: CallDockProps) {
  const { t } = useTranslation('calls');
  const { t: tStatus } = useTranslation('status');
  const {
    state, conversations, allUsers, activeCallConversationId, dmStartedAt,
    startCamera, stopCamera, startSharing, stopSharing, activateMic, toggleMicMuted,
    deafened, toggleDeafened, leaveCall, preferMuted, setPreferMuted, reconnecting, ownStatus,
  } = useRoom();
  const customStatus = useCustomStatus(state.me.userId);
  const [statusError, setStatusError] = useTransientError();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const compact = layout === 'compact';
  const onSettings = pathname.startsWith(ROUTES.settings);
  const inCall = !!activeCallConversationId;
  const duration = useCallDuration(inCall ? dmStartedAt : null);
  const myMedia = useParticipantMedia(state.me.id ?? '');
  const cameraOn = state.me.cameraOn;
  const sharing = state.me.sharing;
  const micProblem = myMedia.micActivated ? null : state.micProblem;
  const micLabel = inCall
    ? (micProblem ? t(MIC_PROBLEM_LABEL_KEY[micProblem]) : !myMedia.micActivated ? t('controls.micActivate') : myMedia.micMuted ? t('controls.micUnmute') : t('controls.micMute'))
    : preferMuted ? t('controls.micUnmute') : t('controls.micMute');
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

  const leaveButton = (
    <Tooltip>
      <TooltipTrigger
        onClick={() => void leaveCall()}
        aria-label={t('controls.leaveCall')}
        className={cn(DOCK_BUTTON, compact ? 'bg-red text-white hover:bg-red-hover' : 'text-text-secondary hover:bg-fill-hover hover:text-red-text')}
      >
        <PhoneSlashIcon size={20} weight="fill" />
      </TooltipTrigger>
      <TooltipContent side={compact ? 'right' : 'top'}>{t('controls.leaveCall')}</TooltipContent>
    </Tooltip>
  );
  const tipSide = compact ? 'right' : 'top';

  return (
    // Discord's user panel: the shell's black with a hairline a shade darker
    // than the panel's own, so it reads as laid over the rail and the list
    <div className={cn(
      'flex flex-col rounded-[10px] border border-border-panel bg-surface-app',
      // the compact card is 48px wide: its buttons only fit with a thinner edge
      compact ? 'items-center gap-1 p-1' : 'p-2',
    )}>
      {inCall && (compact ? (
        <div className="flex flex-col items-center gap-1">
          {leaveButton}
        </div>
      ) : (
        <div className="-mx-2 mb-2 flex items-center gap-2 border-b border-border-panel px-3 pb-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1">
              <CallPingIndicator />
              <p className="text-label font-semibold text-green">{duration ? t('controls.inCallFor', { time: duration }) : t('controls.inCall')}</p>
            </div>
            <button type="button" onClick={onReturnToCall} className="block max-w-full truncate text-left text-caption text-text-secondary hover:text-text-primary hover:underline">{title}</button>
          </div>
          {leaveButton}
        </div>
      ))}
      {statusError && <p role="alert" className="mb-1.5 px-1 text-caption text-red-text">{statusError}</p>}
      <div className={cn('flex items-center gap-0.5', compact && 'flex-col')}>
        <StatusMenu
          side={compact ? 'right' : 'top'}
          onOpenProfile={() => { if (state.me.userId) onOpenProfile(state.me.userId); }}
          onError={setStatusError}
          trigger={(
            <button
              type="button"
              aria-label={tStatus('menu.trigger')}
              className={cn(
                'flex items-center gap-2 rounded-lg text-left transition-colors hover:bg-fill-hover data-popup-open:bg-fill-hover',
                compact ? 'p-0.5' : 'min-w-0 flex-1 py-1 pl-1 pr-2',
              )}
            >
              <span className="relative flex-none">
                <Avatar id={state.me.userId ?? state.me.id ?? 'me'} name={state.me.displayName} avatar={state.me.avatar} avatarColor={state.me.avatarColor} size={32} />
                {/* your chosen status while connected; gray while the connection is being re-established */}
                <StatusDot status={reconnecting ? 'reconnecting' : ownStatus.effective} labelled={!reconnecting} className="absolute -bottom-0.5 -right-0.5 size-3.5 border-[3px] text-surface-app" />
              </span>
              {!compact && (
                <span className="min-w-0 leading-tight">
                  <span className="block truncate text-label font-semibold text-text-primary">{state.me.displayName}</span>
                  {reconnecting
                    ? <span className="block truncate text-caption text-text-secondary">{t('controls.statusReconnecting')}</span>
                    : customStatus
                      ? <CustomStatusText custom={customStatus} className="text-caption text-text-secondary" />
                      : <span className="block truncate text-caption text-text-secondary">{tStatus(`statuses.${ownStatus.effective}`)}</span>}
                </span>
              )}
            </button>
          )}
        />
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
            aria-label={deafened ? t('controls.listenAgain') : t('controls.stopListening')}
            className={cn(DOCK_BUTTON, deafened ? DOCK_RED : DOCK_NEUTRAL)}
          >
            {deafened ? <SpeakerSlashIcon size={20} weight={iconWeight(true)} /> : <SpeakerHighIcon size={20} />}
          </TooltipTrigger>
          <TooltipContent side={tipSide}>{deafened ? t('controls.listenAgain') : t('controls.stopListening')}</TooltipContent>
        </Tooltip>
        {inCall && (
          <>
            <Tooltip>
              <TooltipTrigger
                onClick={() => { void (cameraOn ? stopCamera() : startCamera()); }}
                aria-label={cameraOn ? t('controls.cameraOff') : t('controls.cameraOn')}
                className={cn(DOCK_BUTTON, cameraOn ? DOCK_GREEN : DOCK_NEUTRAL)}
              >
                {cameraOn ? <VideoCameraIcon size={20} weight={iconWeight(true)} /> : <VideoCameraSlashIcon size={20} />}
              </TooltipTrigger>
              <TooltipContent side={tipSide}>{cameraOn ? t('controls.cameraOff') : t('controls.cameraOn')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                onClick={() => { void (sharing ? stopSharing() : startSharing()); }}
                aria-label={sharing ? t('controls.shareStop') : t('controls.shareStart')}
                className={cn(DOCK_BUTTON, sharing ? DOCK_GREEN : DOCK_NEUTRAL)}
              >
                <MonitorIcon size={20} weight={iconWeight(sharing)} />
              </TooltipTrigger>
              <TooltipContent side={tipSide}>{sharing ? t('controls.shareStop') : t('controls.shareStart')}</TooltipContent>
            </Tooltip>
          </>
        )}
        <Tooltip>
          <TooltipTrigger
            // a button, not a link: it opens the settings modal
            onClick={() => { navigate(ROUTES.settings); onNavigate?.(); }}
            aria-label={t('controls.settings')}
            aria-haspopup="dialog"
            aria-expanded={onSettings}
            className={cn(DOCK_BUTTON, onSettings ? 'bg-fill-active text-text-primary' : DOCK_NEUTRAL)}
          >
            <GearIcon size={20} weight={iconWeight(onSettings)} aria-hidden />
          </TooltipTrigger>
          <TooltipContent side={tipSide}>{t('controls.settings')}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
