import { ArrowsInIcon, ArrowsOutIcon, MicrophoneIcon, MicrophoneSlashIcon, MonitorIcon, PhoneSlashIcon, SpeakerHighIcon, SpeakerSlashIcon, VideoCameraIcon, VideoCameraSlashIcon } from '@phosphor-icons/react';
import { forwardRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { iconWeight } from '@/shared/ui/icons';

import { CloseButton } from '@/shared/ui/primitives/close-button';
import { useRoom } from '../../state/RoomContext';
import type { MicProblem } from '@/state/roomReducer';
import { useParticipantMedia } from './useLiveKitTrack';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/primitives/tooltip';
import { CallSettingsMenu } from './CallSettingsMenu';
import { CameraQuickMenu, MicQuickMenu, ScreenShareQuickMenu, SpeakerQuickMenu } from './CallDeviceMenus';
import { SoundboardButton } from '@/features/soundboard/SoundboardButton';
import { useCallPublishRights } from './publishRights';
import { hasPermission, PERMISSIONS } from '@/features/servers/permissionBits';
import { cn } from '@/shared/lib/utils';

const MIC_PROBLEM_LABEL_KEY = {
  'not-found': 'micProblem.notFoundLabel',
  denied: 'micProblem.deniedLabel',
  unavailable: 'micProblem.unavailableLabel',
} as const;

const MIC_PROBLEM_NOTICE_KEY = {
  'not-found': 'micProblem.notFoundNotice',
  denied: 'micProblem.deniedNotice',
  unavailable: 'micProblem.unavailableNotice',
} as const;

// Keep the controls legible over the call stage regardless of the app theme.
// Compact them at narrow viewport widths.
const BAR_BUTTON = 'grid size-11 flex-none place-items-center rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-white/50 active:translate-y-px max-[480px]:size-10 max-[480px]:rounded-[14px] max-[360px]:size-9 max-[360px]:rounded-[13px]';
const BAR_BUTTON_NEUTRAL = 'bg-white/5 text-white/90 hover:bg-white/12';
const BAR_BUTTON_RED = 'bg-red/16 text-red hover:bg-red/24';
const BAR_BUTTON_GREEN = 'bg-green/16 text-green hover:bg-green/24';
// a control the channel's permissions turn off: still focusable, so its tooltip says why
const BAR_BUTTON_LOCKED = 'cursor-not-allowed bg-white/5 text-white/35';
const BAR_ICON = 'size-[22px] max-[480px]:size-5 max-[360px]:size-[19px]';

interface CallControlBarProps {
  /** Fades out (but stays mounted, never affecting layout) when the HUD
   * auto-hides after inactivity — see useCallHud.ts. */
  hudVisible?: boolean;
}

// Stage measures the rendered height to reserve space for the bar and any banners.
export const CallControlBar = forwardRef<HTMLDivElement, CallControlBarProps>(function CallControlBar({ hudVisible = true }, ref) {
  const { t } = useTranslation('calls');
  const {
    state, dispatch, startCamera, stopCamera, startSharing, stopSharing, activateMic, toggleMicMuted, deafened, toggleDeafened,
    leaveCall, reconnecting, isCallFullscreen, toggleCallFullscreen,
    activeCallConversationId, conversations, servers,
  } = useRoom();
  // sounds belong to a server, so a 1:1 call has no soundboard
  const callChannel = conversations.find((c) => c.id === activeCallConversationId && c.type === 'voice');
  const soundboardServerId = callChannel?.serverId ?? null;
  const callServer = servers.find((server) => server.id === soundboardServerId);
  // the server drops a play without USE_SOUNDBOARD there, so don't offer one
  const canUseSoundboard = !!callChannel && (callChannel.permissions === undefined || hasPermission(callChannel.permissions, PERMISSIONS.USE_SOUNDBOARD));
  const myMedia = useParticipantMedia(state.me.id ?? '');
  const cameraOn = state.me.cameraOn;
  const sharing = state.me.sharing;
  const micProblem = myMedia.micActivated ? null : state.micProblem;
  // Dismissing hides this occurrence only: once the problem clears, the next
  // one (a later call, the mic unplugged again) has to show again.
  const [dismissedMicProblem, setDismissedMicProblem] = useState<MicProblem>(null);
  if (!micProblem && dismissedMicProblem) setDismissedMicProblem(null);
  const { canSpeak, canStream } = useCallPublishRights();
  const micLabel = !canSpeak ? t('controls.noSpeakPermission') : micProblem ? t(MIC_PROBLEM_LABEL_KEY[micProblem]) : !myMedia.micActivated ? t('controls.micActivate') : myMedia.micMuted ? t('controls.micUnmute') : t('controls.micMute');
  const cameraLabel = !canStream ? t('controls.noStreamPermission') : cameraOn ? t('controls.cameraOff') : t('controls.cameraOn');
  const shareLabel = !canStream ? t('controls.noStreamPermission') : sharing ? t('controls.shareStop') : t('controls.shareStart');

  return (
    <div
      ref={ref}
      className={cn(
        'absolute bottom-[calc(0.25rem+env(safe-area-inset-bottom))] left-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-2 transition-opacity duration-200 motion-reduce:transition-none',
        hudVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
      )}
    >
      {reconnecting && (
        <div className="rounded-md border border-border-strong bg-bg-floating px-3 py-2 text-label text-text-secondary shadow-popover">
          {t('controls.reconnecting')}
        </div>
      )}
      {state.shareError && (
        <div className="flex max-w-[calc(100vw-2rem)] items-start gap-2 rounded-md border border-border-strong bg-bg-floating px-3 py-2 text-label text-text-secondary shadow-popover md:max-w-100">
          <span className="min-w-0 flex-1">{state.shareError}</span>
          <CloseButton size="xs" label={t('controls.dismissNotice')} onClick={() => dispatch({ type: 'SET_SHARE_ERROR', message: null })} />
        </div>
      )}
      {micProblem && micProblem !== dismissedMicProblem && (
        <div role="status" className="flex max-w-[calc(100vw-2rem)] items-start gap-2 rounded-md border border-red/40 bg-bg-floating px-3 py-2 text-label text-text-secondary shadow-popover md:max-w-100">
          <MicrophoneSlashIcon size={16} className="mt-0.5 flex-none text-red" />
          <span className="min-w-0 flex-1">{t(MIC_PROBLEM_NOTICE_KEY[micProblem])}</span>
          <CloseButton size="xs" label={t('controls.dismissNotice')} onClick={() => setDismissedMicProblem(micProblem)} />
        </div>
      )}
      <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-black p-1.5 shadow-popover max-[480px]:gap-0.75 max-[480px]:p-1.25 max-[360px]:gap-0.5 max-[360px]:p-1">
        <div className="relative">
          <Tooltip>
            <TooltipTrigger
              onClick={() => { if (canSpeak) void (myMedia.micActivated ? toggleMicMuted() : activateMic()); }}
              aria-label={micLabel}
              aria-disabled={!canSpeak || undefined}
              className={cn(BAR_BUTTON, 'relative', !canSpeak ? BAR_BUTTON_LOCKED : myMedia.micMuted || micProblem ? BAR_BUTTON_RED : BAR_BUTTON_NEUTRAL)}
            >
              {myMedia.micMuted || !canSpeak ? <MicrophoneSlashIcon size="100%" weight={iconWeight(true)} className={BAR_ICON} /> : <MicrophoneIcon size="100%" className={BAR_ICON} />}
              {micProblem && canSpeak && <span aria-hidden className="absolute right-0.5 top-0.5 h-2.5 w-2.5 rounded-full border-2 border-black bg-red" />}
            </TooltipTrigger>
            <TooltipContent>{micLabel}</TooltipContent>
          </Tooltip>
          <MicQuickMenu />
        </div>

        <div className="relative">
          <Tooltip>
            <TooltipTrigger
              onClick={toggleDeafened}
              aria-label={deafened ? t('controls.listenAgain') : t('controls.stopListening')}
              className={cn(BAR_BUTTON, deafened ? BAR_BUTTON_RED : BAR_BUTTON_NEUTRAL)}
            >
              {deafened ? <SpeakerSlashIcon size={22} weight={iconWeight(true)} className={BAR_ICON} /> : <SpeakerHighIcon size={22} className={BAR_ICON} />}
            </TooltipTrigger>
            <TooltipContent>{deafened ? t('controls.listenAgain') : t('controls.stopListening')}</TooltipContent>
          </Tooltip>
          <SpeakerQuickMenu />
        </div>

        <div className="relative">
          <Tooltip>
            <TooltipTrigger
              onClick={() => { if (canStream || cameraOn) void (cameraOn ? stopCamera() : startCamera()); }}
              aria-label={cameraLabel}
              aria-disabled={(!canStream && !cameraOn) || undefined}
              className={cn(BAR_BUTTON, cameraOn ? BAR_BUTTON_GREEN : !canStream ? BAR_BUTTON_LOCKED : BAR_BUTTON_NEUTRAL)}
            >
              {cameraOn ? <VideoCameraIcon size={22} weight={iconWeight(true)} className={BAR_ICON} /> : <VideoCameraSlashIcon size={22} className={BAR_ICON} />}
            </TooltipTrigger>
            <TooltipContent>{cameraLabel}</TooltipContent>
          </Tooltip>
          <CameraQuickMenu />
        </div>

        <div className="relative">
          <Tooltip>
            <TooltipTrigger
              onClick={() => { if (canStream || sharing) void (sharing ? stopSharing() : startSharing()); }}
              aria-label={shareLabel}
              aria-disabled={(!canStream && !sharing) || undefined}
              className={cn(BAR_BUTTON, sharing ? BAR_BUTTON_GREEN : !canStream ? BAR_BUTTON_LOCKED : BAR_BUTTON_NEUTRAL)}
            >
              <MonitorIcon size={22} weight={iconWeight(sharing)} className={BAR_ICON} />
            </TooltipTrigger>
            <TooltipContent>{shareLabel}</TooltipContent>
          </Tooltip>
          <ScreenShareQuickMenu />
        </div>

        {soundboardServerId && callChannel && canUseSoundboard && (
          <SoundboardButton
            serverId={soundboardServerId}
            conversationId={callChannel.id}
            canUpload={!!callServer && hasPermission(callServer.permissions, PERMISSIONS.CREATE_EXPRESSIONS)}
            className={cn(BAR_BUTTON, BAR_BUTTON_NEUTRAL)}
            activeClassName="bg-white/12 text-white"
            iconClassName={BAR_ICON}
          />
        )}

        <Tooltip>
          <TooltipTrigger
            onClick={() => void toggleCallFullscreen()}
            aria-label={isCallFullscreen ? t('controls.fullscreenExit') : t('controls.fullscreenEnter')}
            className={cn(BAR_BUTTON, BAR_BUTTON_NEUTRAL)}
          >
            {isCallFullscreen ? <ArrowsInIcon size={22} className={BAR_ICON} /> : <ArrowsOutIcon size={22} className={BAR_ICON} />}
          </TooltipTrigger>
          <TooltipContent>{isCallFullscreen ? t('controls.fullscreenExit') : t('controls.fullscreenEnter')}</TooltipContent>
        </Tooltip>

        <CallSettingsMenu triggerClassName={cn(BAR_BUTTON, BAR_BUTTON_NEUTRAL)} />

        <div aria-hidden className="mx-0.5 h-6 w-px flex-none bg-white/10" />

        <Tooltip>
          <TooltipTrigger
            onClick={leaveCall}
            aria-label={t('controls.leaveCall')}
            className={cn(BAR_BUTTON, 'bg-red text-white hover:bg-red-hover')}
          >
            <PhoneSlashIcon size="100%" weight="fill" className={BAR_ICON} />
          </TooltipTrigger>
          <TooltipContent>{t('controls.leaveCall')}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
});
