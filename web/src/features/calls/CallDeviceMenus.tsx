import { ArrowsClockwiseIcon, CaretDownIcon, FlipHorizontalIcon, GearIcon, LockKeyOpenIcon, PauseIcon, PlayIcon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';

import { Track } from 'livekit-client';
import type { LocalAudioTrack, Room } from 'livekit-client';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuOptionItem, DropdownMenuRadioGroup, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent,
  DropdownMenuSubTrigger, DropdownMenuSwitchItem, DropdownMenuTrigger,
} from '@/shared/ui/primitives/dropdown-menu';
import { Slider } from '@/shared/ui/primitives/slider';
import { useMediaDevices } from '@/features/settings/useMediaDevices';
import { useRoom } from '@/state/RoomContext';
import { logger } from '@/shared/lib/logger';
import { useParticipantMedia } from './useLiveKitTrack';
import { SHARE_QUALITY_PRESETS } from './shareQualityPresets';
import type { ShareQualityId } from './shareQualityPresets';
import { ShareQualityIcon } from './ShareQualityIcon';
import { setAudioPreference, useAudioPreferences } from './audioPreferences';
import type { InputProfile } from './audioPreferences';
import { applyInputGain } from './inputGain';
import { applyInputProfile } from './inputProfile';
import { useMicInputLevel } from './useMicInputLevel';
import { ROUTES } from '@/shared/lib/routes';
import { cn } from '@/shared/lib/utils';

const log = logger.child({ component: 'call-device-menus' });

// Keep device menus visually consistent with the call control bar. Same black/white-based material as the bar itself,
// not the app's theme.
const CORNER_TRIGGER = 'absolute -right-0.5 -top-0.5 z-10 grid size-[17px] place-items-center rounded-[7px] bg-black text-white/70 ring-1 ring-white/15 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60';

// The anchor is the 17px corner trigger, so without an explicit width the
// popup falls back to its min-width and squeezes device names.
const MENU_CONTENT = 'w-68 max-w-[calc(100vw-1.5rem)] p-2';
const MENU_LABEL = 'px-2 pb-1 pt-2 text-caption font-semibold uppercase tracking-wide';
const MENU_NOTE = 'px-2 py-2 text-label text-text-muted';
const ROW_TITLE = 'text-body font-medium text-text-primary';
const ROW_VALUE = 'text-label text-text-muted';
const SEPARATOR = 'mx-0 my-1.5';
// Bigger thumb and track than the tile menu's slider, so the volume reads
// as the row's main control rather than a detail.
const VOLUME_SLIDER = '[&_[data-slot=slider-track]]:h-1.5 [&_[data-slot=slider-thumb]]:size-4 [&_[data-slot=slider-thumb]]:border-0 [&_[data-slot=slider-thumb]]:shadow-sm';
const METER_SEGMENTS = 24;

/** A row that opens a submenu, showing its current value under the title. */
function ValueSubmenu({ title, value, children }: { title: string; value: string; children: ReactNode }) {
  const { fullscreenElement } = useRoom();
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="gap-3 whitespace-normal px-2 py-2 [&>svg]:text-text-muted">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className={ROW_TITLE}>{title}</span>
          <span className={cn(ROW_VALUE, 'line-clamp-2')}>{value}</span>
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent container={fullscreenElement ?? undefined} sideOffset={6} className="w-72 max-w-[calc(100vw-1.5rem)] p-1.5">
        {children}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function DeviceSubmenu({ room, kind, title, label }: { room: Room; kind: MediaDeviceKind; title: string; label: string }) {
  const { t } = useTranslation('calls');
  // Only enumerates (silent, no getUserMedia) — opening this menu never
  // starts a capture on its own; requestPermission below is the one
  // explicit gesture that does.
  const { devices, activeDeviceId, status, switching, error, selectDevice, requestPermission } = useMediaDevices(room, kind);
  const current = devices.find((d) => d.deviceId === activeDeviceId) ?? devices[0];
  const value = status === 'permission-needed' ? t('devices.permission')
    : status === 'unsupported' || status === 'permission-denied' ? t('devices.listFailed')
    : status === 'no-devices' ? t('devices.none')
    : current?.label || t('devices.unnamed');

  return (
    <ValueSubmenu title={title} value={value}>
      {status === 'permission-needed' ? (
        <DropdownMenuItem className="px-2 py-2" onClick={() => void requestPermission()}><LockKeyOpenIcon size={16} />{t('devices.permission')}</DropdownMenuItem>
      ) : status === 'unsupported' || status === 'permission-denied' ? (
        <p className={MENU_NOTE}>{t('devices.listFailed')}</p>
      ) : status === 'no-devices' ? (
        <p className={MENU_NOTE}>{t('devices.none')}</p>
      ) : (
        <>
          <DropdownMenuRadioGroup aria-label={label} value={activeDeviceId} onValueChange={(v) => { if (v) void selectDevice(v as string); }}>
            {devices.map((d) => (
              <DropdownMenuOptionItem key={d.deviceId} value={d.deviceId} disabled={switching} className="whitespace-normal">
                {d.label || t('devices.unnamed')}
              </DropdownMenuOptionItem>
            ))}
          </DropdownMenuRadioGroup>
          {error && <p role="alert" className="px-2 py-2 text-label text-red">{error}</p>}
        </>
      )}
    </ValueSubmenu>
  );
}

const INPUT_PROFILES: InputProfile[] = ['voice-isolation', 'studio'];

function InputProfileSubmenu() {
  const { t } = useTranslation('calls');
  const { livekitRoom } = useRoom();
  const { inputProfile } = useAudioPreferences();

  function pick(profile: InputProfile) {
    setAudioPreference('inputProfile', profile);
    applyInputProfile(livekitRoom, profile).catch((err) => log.warn('Failed to apply the input profile', { err: String(err) }));
  }

  return (
    <ValueSubmenu title={t('devices.inputProfile')} value={t(`devices.profiles.${inputProfile}.label`)}>
      <DropdownMenuRadioGroup aria-label={t('devices.inputProfile')} value={inputProfile} onValueChange={(v) => { if (v) pick(v as InputProfile); }}>
        {INPUT_PROFILES.map((profile) => (
          <DropdownMenuOptionItem key={profile} value={profile} className="whitespace-normal">
            <span className="flex flex-col gap-0.5">
              <span>{t(`devices.profiles.${profile}.label`)}</span>
              <span className={ROW_VALUE}>{t(`devices.profiles.${profile}.description`)}</span>
            </span>
          </DropdownMenuOptionItem>
        ))}
      </DropdownMenuRadioGroup>
    </ValueSubmenu>
  );
}

function VolumeRow({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <div className="flex flex-col gap-3 px-2 pb-3 pt-2">
      <span className={ROW_TITLE}>{label}</span>
      <Slider
        aria-label={label}
        value={[Math.round(value * 100)]}
        onValueChange={(v) => onChange((Array.isArray(v) ? (v[0] ?? 0) : (v as number)) / 100)}
        min={0}
        max={100}
        className={VOLUME_SLIDER}
      />
    </div>
  );
}

function InputVolumeRow() {
  const { t } = useTranslation('calls');
  const { livekitRoom } = useRoom();
  const { inputVolume } = useAudioPreferences();

  function change(value: number) {
    setAudioPreference('inputVolume', value);
    const track = livekitRoom.localParticipant.getTrackPublication(Track.Source.Microphone)?.track as LocalAudioTrack | undefined;
    if (track) applyInputGain(track, value).catch((err) => log.warn('Failed to apply the input volume', { err: String(err) }));
  }

  return <VolumeRow label={t('devices.inputVolume')} value={inputVolume} onChange={change} />;
}

function InputLevelMeter() {
  const { t } = useTranslation('calls');
  const { state } = useRoom();
  const media = useParticipantMedia(state.me.id ?? '');
  const level = useMicInputLevel(media.micTrack);
  const lit = Math.round(level * METER_SEGMENTS);

  return (
    <div className="flex flex-col gap-3 px-2 pb-2 pt-1">
      <span className={ROW_TITLE}>{t('devices.inputLevel')}</span>
      <div
        role="meter"
        aria-label={t('devices.inputLevel')}
        aria-valuenow={Math.round(level * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="flex h-5 items-stretch justify-between"
      >
        {Array.from({ length: METER_SEGMENTS }, (_, i) => (
          <span key={i} className={cn('w-[5px] rounded-full transition-colors duration-75', i < lit ? 'bg-yellow' : 'bg-foreground/10')} />
        ))}
      </div>
    </div>
  );
}

function SettingsShortcutItem({ label }: { label: string }) {
  const navigate = useNavigate();
  // Leaving the stage's route doesn't end the call — FloatingPip takes over
  // (see App.tsx's showStage/inCall split), same as opening any other page.
  return (
    <DropdownMenuItem className="gap-3 px-2 py-2 text-body font-medium text-text-primary" onClick={() => navigate(ROUTES.settingsTab('av'))}>
      <GearIcon weight="fill" className="size-5 text-text-secondary" />
      {label}
    </DropdownMenuItem>
  );
}

export function MicQuickMenu({ className }: { className?: string }) {
  const { t } = useTranslation('calls');
  const { livekitRoom, fullscreenElement } = useRoom();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={t('devices.micSettings')} className={cn(CORNER_TRIGGER, className)}>
        <CaretDownIcon size={10} />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" container={fullscreenElement ?? undefined} className={MENU_CONTENT}>
        <DeviceSubmenu room={livekitRoom} kind="audioinput" title={t('devices.inputDevice')} label={t('devices.microphone')} />
        <InputProfileSubmenu />
        <DropdownMenuSeparator className={SEPARATOR} />
        <InputVolumeRow />
        <InputLevelMeter />
        <DropdownMenuSeparator className={SEPARATOR} />
        <SettingsShortcutItem label={t('devices.voiceSettings')} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SpeakerQuickMenu({ className }: { className?: string }) {
  const { t } = useTranslation('calls');
  const { livekitRoom, fullscreenElement } = useRoom();
  const { outputVolume } = useAudioPreferences();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={t('devices.audioOutputSettings')} className={cn(CORNER_TRIGGER, className)}>
        <CaretDownIcon size={10} />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" container={fullscreenElement ?? undefined} className={MENU_CONTENT}>
        <DeviceSubmenu room={livekitRoom} kind="audiooutput" title={t('devices.outputDevice')} label={t('devices.speaker')} />
        <DropdownMenuSeparator className={SEPARATOR} />
        <VolumeRow label={t('devices.outputVolume')} value={outputVolume} onChange={(v) => setAudioPreference('outputVolume', v)} />
        <DropdownMenuSeparator className={SEPARATOR} />
        <SettingsShortcutItem label={t('devices.voiceSettings')} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ScreenShareQuickMenu({ className }: { className?: string }) {
  const { t } = useTranslation('calls');
  const { state, shareQuality, setShareQuality, changeSource, pauseSharePreview, resumeSharePreview, fullscreenElement } = useRoom();
  const sharing = state.me.sharing;
  const myMedia = useParticipantMedia(state.me.id ?? '');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={t('devices.screenSettings')} className={cn(CORNER_TRIGGER, className)}>
        <CaretDownIcon size={10} />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" container={fullscreenElement ?? undefined} className={MENU_CONTENT}>
        <DropdownMenuGroup>
          <DropdownMenuLabel className={MENU_LABEL}>{t('menu.quality')}</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={shareQuality} onValueChange={(v) => { if (v) setShareQuality(v as ShareQualityId); }}>
            {(Object.keys(SHARE_QUALITY_PRESETS) as ShareQualityId[]).map((id) => (
              <DropdownMenuOptionItem key={id} value={id}><span className="flex items-center gap-1.5"><ShareQualityIcon id={id} />{t(`quality.${id}`)}</span></DropdownMenuOptionItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        {sharing && (
          <>
            <DropdownMenuSeparator className={SEPARATOR} />
            <DropdownMenuItem className="px-2 py-2" onClick={() => void changeSource()}>
              <ArrowsClockwiseIcon size={16} />
              {t('menu.changeSource')}
            </DropdownMenuItem>
            <DropdownMenuItem className="px-2 py-2" onClick={() => void (myMedia.screenPaused ? resumeSharePreview() : pauseSharePreview())}>
              {myMedia.screenPaused ? <PlayIcon size={16} /> : <PauseIcon size={16} />}
              {myMedia.screenPaused ? t('menu.resumePreview') : t('menu.pausePreview')}
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator className={SEPARATOR} />
        <SettingsShortcutItem label={t('devices.videoSettings')} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function CameraQuickMenu({ className }: { className?: string }) {
  const { t } = useTranslation('calls');
  const { livekitRoom, mirrorCameraPreview, setMirrorCameraPreview, fullscreenElement } = useRoom();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={t('devices.cameraSettings')} className={cn(CORNER_TRIGGER, className)}>
        <CaretDownIcon size={10} />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" container={fullscreenElement ?? undefined} className={MENU_CONTENT}>
        <DeviceSubmenu room={livekitRoom} kind="videoinput" title={t('devices.camera')} label={t('devices.camera')} />
        <DropdownMenuSeparator className={SEPARATOR} />
        <DropdownMenuSwitchItem checked={mirrorCameraPreview} onCheckedChange={setMirrorCameraPreview}>
          <FlipHorizontalIcon size={16} />
          {t('menu.mirror')}
        </DropdownMenuSwitchItem>
        <DropdownMenuSeparator className={SEPARATOR} />
        <SettingsShortcutItem label={t('devices.videoSettings')} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
