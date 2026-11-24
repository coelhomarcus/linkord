import { ArrowsInIcon, ArrowsOutIcon, MicrophoneIcon, MicrophoneSlashIcon, MonitorIcon, PhoneSlashIcon, SpeakerHighIcon, SpeakerSlashIcon, VideoCameraIcon, VideoCameraSlashIcon, iconWeight } from '@/shared/ui/icons';
import { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';

import { CloseButton } from '@/shared/ui/primitives/close-button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/primitives/tooltip';
import { CallSettingsMenu } from './CallSettingsMenu';
import { CameraQuickMenu, MicQuickMenu, ScreenShareQuickMenu, SpeakerQuickMenu } from './CallDeviceMenus';
import { SoundboardButton } from '@/features/soundboard/SoundboardButton';
import { useCallControls } from './useCallControls';
import { cn } from '@/shared/lib/utils';

// Keep the controls legible over the call stage regardless of the app theme.
// Compact them at narrow viewport widths.
const BAR_BUTTON = 'grid size-11 flex-none place-items-center rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-white/50 active:translate-y-px max-[480px]:size-10 max-[480px]:rounded-[14px] max-[360px]:size-9 max-[360px]:rounded-[13px]';
const BAR_BUTTON_NEUTRAL = 'bg-white/5 text-white/90 hover:bg-white/12';
const BAR_BUTTON_RED = 'bg-red/16 text-red hover:bg-red/24';
const BAR_BUTTON_GREEN = 'bg-green/16 text-green hover:bg-green/24';
// a control the channel's permissions turn off: still focusable, so its tooltip says why
const BAR_BUTTON_LOCKED = 'cursor-not-allowed bg-white/5 text-white/35';
const BAR_ICON = 'size-[22px] max-[480px]:size-5 max-[360px]:size-[19px]';

// Stage measures the rendered height to reserve space for the bar and any banners.
export const CallControlBar = forwardRef<HTMLDivElement>(function CallControlBar(_props, ref) {
  const { t } = useTranslation('calls');
  const { mic, deafen, camera, share, fullscreen, soundboard, leave, leaveLabel, reconnecting, shareError, dismissShareError, micNotice, dismissMicNotice } = useCallControls();

  return (
    <div
      ref={ref}
      // always on screen: it never fades out while the call sits idle
      className="absolute bottom-[calc(0.25rem+env(safe-area-inset-bottom))] left-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-2"
    >
      {reconnecting && (
        <div className="rounded-md border border-border-strong bg-bg-floating px-3 py-2 text-label text-text-secondary shadow-popover">
          {t('controls.reconnecting')}
        </div>
      )}
      {shareError && (
        <div className="flex max-w-[calc(100vw-2rem)] items-start gap-2 rounded-md border border-border-strong bg-bg-floating px-3 py-2 text-label text-text-secondary shadow-popover md:max-w-100">
          <span className="min-w-0 flex-1">{shareError}</span>
          <CloseButton size="xs" label={t('controls.dismissNotice')} onClick={dismissShareError} />
        </div>
      )}
      {micNotice && (
        <div role="status" className="flex max-w-[calc(100vw-2rem)] items-start gap-2 rounded-md border border-red/40 bg-bg-floating px-3 py-2 text-label text-text-secondary shadow-popover md:max-w-100">
          <MicrophoneSlashIcon size={16} className="mt-0.5 flex-none text-red" />
          <span className="min-w-0 flex-1">{micNotice}</span>
          <CloseButton size="xs" label={t('controls.dismissNotice')} onClick={dismissMicNotice} />
        </div>
      )}
      <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-black p-1.5 shadow-popover max-[480px]:gap-0.75 max-[480px]:p-1.25 max-[360px]:gap-0.5 max-[360px]:p-1">
        <div className="relative">
          <Tooltip>
            <TooltipTrigger
              onClick={mic.toggle}
              aria-label={mic.label}
              aria-disabled={mic.locked || undefined}
              className={cn(BAR_BUTTON, 'relative', mic.locked ? BAR_BUTTON_LOCKED : mic.muted || mic.problem ? BAR_BUTTON_RED : BAR_BUTTON_NEUTRAL)}
            >
              {mic.muted || mic.locked ? <MicrophoneSlashIcon size="100%" weight={iconWeight(true)} className={BAR_ICON} /> : <MicrophoneIcon size="100%" className={BAR_ICON} />}
              {mic.problem && !mic.locked && <span aria-hidden className="absolute right-0.5 top-0.5 h-2.5 w-2.5 rounded-full border-2 border-black bg-red" />}
            </TooltipTrigger>
            <TooltipContent>{mic.label}</TooltipContent>
          </Tooltip>
          <MicQuickMenu />
        </div>

        <div className="relative">
          <Tooltip>
            <TooltipTrigger
              onClick={deafen.toggle}
              aria-label={deafen.label}
              className={cn(BAR_BUTTON, deafen.on ? BAR_BUTTON_RED : BAR_BUTTON_NEUTRAL)}
            >
              {deafen.on ? <SpeakerSlashIcon size={22} weight={iconWeight(true)} className={BAR_ICON} /> : <SpeakerHighIcon size={22} className={BAR_ICON} />}
            </TooltipTrigger>
            <TooltipContent>{deafen.label}</TooltipContent>
          </Tooltip>
          <SpeakerQuickMenu />
        </div>

        <div className="relative">
          <Tooltip>
            <TooltipTrigger
              onClick={camera.toggle}
              aria-label={camera.label}
              aria-disabled={camera.locked || undefined}
              className={cn(BAR_BUTTON, camera.on ? BAR_BUTTON_GREEN : camera.locked ? BAR_BUTTON_LOCKED : BAR_BUTTON_NEUTRAL)}
            >
              {camera.on ? <VideoCameraIcon size={22} weight={iconWeight(true)} className={BAR_ICON} /> : <VideoCameraSlashIcon size={22} className={BAR_ICON} />}
            </TooltipTrigger>
            <TooltipContent>{camera.label}</TooltipContent>
          </Tooltip>
          <CameraQuickMenu />
        </div>

        <div className="relative">
          <Tooltip>
            <TooltipTrigger
              onClick={share.toggle}
              aria-label={share.label}
              aria-disabled={share.locked || undefined}
              className={cn(BAR_BUTTON, share.on ? BAR_BUTTON_GREEN : share.locked ? BAR_BUTTON_LOCKED : BAR_BUTTON_NEUTRAL)}
            >
              <MonitorIcon size={22} weight={iconWeight(share.on)} className={BAR_ICON} />
            </TooltipTrigger>
            <TooltipContent>{share.label}</TooltipContent>
          </Tooltip>
          <ScreenShareQuickMenu />
        </div>

        {soundboard && (
          <SoundboardButton
            conversationId={soundboard.conversationId}
            callServerId={soundboard.serverId}
            className={cn(BAR_BUTTON, BAR_BUTTON_NEUTRAL)}
            activeClassName="bg-white/12 text-white"
            iconClassName={BAR_ICON}
          />
        )}

        <Tooltip>
          <TooltipTrigger
            onClick={fullscreen.toggle}
            aria-label={fullscreen.label}
            className={cn(BAR_BUTTON, BAR_BUTTON_NEUTRAL)}
          >
            {fullscreen.on ? <ArrowsInIcon size={22} className={BAR_ICON} /> : <ArrowsOutIcon size={22} className={BAR_ICON} />}
          </TooltipTrigger>
          <TooltipContent>{fullscreen.label}</TooltipContent>
        </Tooltip>

        <CallSettingsMenu triggerClassName={cn(BAR_BUTTON, BAR_BUTTON_NEUTRAL)} />

        <div aria-hidden className="mx-0.5 h-6 w-px flex-none bg-white/10" />

        <Tooltip>
          <TooltipTrigger
            onClick={leave}
            aria-label={leaveLabel}
            className={cn(BAR_BUTTON, 'bg-red text-white hover:bg-red-hover')}
          >
            <PhoneSlashIcon size="100%" weight="fill" className={BAR_ICON} />
          </TooltipTrigger>
          <TooltipContent>{leaveLabel}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
});
