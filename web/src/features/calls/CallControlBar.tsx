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

// The bar is intentionally theme-independent (black material, white-based
// states) — it stays the same over the dark call stage regardless of the
// app's own light/dark theme, matching the Fluxer reference. Sizes shrink
// at 480/360px (viewport width, not the stage's own measured width — the
// stage doesn't expose that yet; see the calls redesign plan's E5/E10).
const BAR_BUTTON = 'grid size-11 flex-none place-items-center rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-white/50 active:translate-y-px max-[480px]:size-10 max-[480px]:rounded-[14px] max-[360px]:size-9 max-[360px]:rounded-[13px]';
const BAR_BUTTON_NEUTRAL = 'bg-white/5 text-white/90 hover:bg-white/12';
const BAR_BUTTON_RED = 'bg-red/16 text-red hover:bg-red/24';
const BAR_BUTTON_GREEN = 'bg-green/16 text-green hover:bg-green/24';
const BAR_ICON = 'size-[22px] max-[480px]:size-5 max-[360px]:size-[19px]';

interface CallControlBarProps {
  /** Fades out (but stays mounted, never affecting layout) when the HUD
   * auto-hides after inactivity — see useCallHud.ts. */
  hudVisible?: boolean;
}

// forwardRef so Stage.tsx can measure this wrapper's real rendered height
// (banners + bar + gaps) and reserve exactly that much space for it instead
// of a fixed `pb-32` guess (see the calls redesign plan §5.1).
export const CallControlBar = forwardRef<HTMLDivElement, CallControlBarProps>(function CallControlBar({ hudVisible = true }, ref) {
  const { t } = useTranslation('calls');
  const {
    state, dispatch, startCamera, stopCamera, startSharing, stopSharing, activateMic, toggleMicMuted, deafened, toggleDeafened,
    leaveCall, reconnecting, isCallFullscreen, toggleCallFullscreen,
    activeCallConversationId, conversations,
  } = useRoom();
  // sounds belong to a group, so a 1:1 call has no soundboard
  const soundboardGroupId = conversations.find((c) => c.id === activeCallConversationId && c.type === 'group')?.id ?? null;
  const myMedia = useParticipantMedia(state.me.id ?? '');
  const cameraOn = state.me.cameraOn;
  const sharing = state.me.sharing;
  const micProblem = myMedia.micActivated ? null : state.micProblem;
  // Dismissing hides this occurrence only: once the problem clears, the next
  // one (a later call, the mic unplugged again) has to show again.
  const [dismissedMicProblem, setDismissedMicProblem] = useState<MicProblem>(null);
  if (!micProblem && dismissedMicProblem) setDismissedMicProblem(null);
  const micLabel = micProblem ? t(MIC_PROBLEM_LABEL_KEY[micProblem]) : !myMedia.micActivated ? t('controls.micActivate') : myMedia.micMuted ? t('controls.micUnmute') : t('controls.micMute');

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
              onClick={() => { void (myMedia.micActivated ? toggleMicMuted() : activateMic()); }}
              aria-label={micLabel}
              className={cn(BAR_BUTTON, 'relative', myMedia.micMuted || micProblem ? BAR_BUTTON_RED : BAR_BUTTON_NEUTRAL)}
            >
              {myMedia.micMuted ? <MicrophoneSlashIcon size="100%" weight={iconWeight(true)} className={BAR_ICON} /> : <MicrophoneIcon size="100%" className={BAR_ICON} />}
              {micProblem && <span aria-hidden className="absolute right-0.5 top-0.5 h-2.5 w-2.5 rounded-full border-2 border-black bg-red" />}
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
              onClick={() => { void (cameraOn ? stopCamera() : startCamera()); }}
              aria-label={cameraOn ? t('controls.cameraOff') : t('controls.cameraOn')}
              className={cn(BAR_BUTTON, cameraOn ? BAR_BUTTON_GREEN : BAR_BUTTON_NEUTRAL)}
            >
              {cameraOn ? <VideoCameraIcon size={22} weight={iconWeight(true)} className={BAR_ICON} /> : <VideoCameraSlashIcon size={22} className={BAR_ICON} />}
            </TooltipTrigger>
            <TooltipContent>{cameraOn ? t('controls.cameraOff') : t('controls.cameraOn')}</TooltipContent>
          </Tooltip>
          <CameraQuickMenu />
        </div>

        <div className="relative">
          <Tooltip>
            <TooltipTrigger
              onClick={() => { void (sharing ? stopSharing() : startSharing()); }}
              aria-label={sharing ? t('controls.shareStop') : t('controls.shareStart')}
              className={cn(BAR_BUTTON, sharing ? BAR_BUTTON_GREEN : BAR_BUTTON_NEUTRAL)}
            >
              <MonitorIcon size={22} weight={iconWeight(sharing)} className={BAR_ICON} />
            </TooltipTrigger>
            <TooltipContent>{sharing ? t('controls.shareStop') : t('controls.shareStart')}</TooltipContent>
          </Tooltip>
          <ScreenShareQuickMenu />
        </div>

        {soundboardGroupId && (
          <SoundboardButton
            conversationId={soundboardGroupId}
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
