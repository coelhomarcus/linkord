import { HeadphonesIcon, MicrophoneIcon, VideoCameraIcon } from '@phosphor-icons/react';
import { Track } from 'livekit-client';
import type { LocalAudioTrack } from 'livekit-client';
import { useTranslation } from 'react-i18next';
import { useRoom } from '@/state/RoomContext';
import { logger } from '@/shared/lib/logger';
import { Slider } from '@/shared/ui/primitives/slider';
import { Switch } from '@/shared/ui/primitives/switch';
import { setAudioPreference, useAudioPreferences } from '@/features/calls/audioPreferences';
import type { InputProfile } from '@/features/calls/audioPreferences';
import { applyInputGain } from '@/features/calls/inputGain';
import { applyInputProfile } from '@/features/calls/inputProfile';
import { CameraPreview, DeviceSelect, MicTest, SpeakerTestLink } from './DevicePicker';
import { SettingsDivider, SettingsRadioGroup, SettingsRow, SettingsSection, SettingsSections, SettingsSubheading } from '@/shared/ui/settings-layout';
import { useMediaDevices } from './useMediaDevices';
import type { MediaDevicesStatus } from './useMediaDevices';

const log = logger.child({ component: 'av-settings' });
const INPUT_PROFILES: InputProfile[] = ['voice-isolation', 'studio'];

/** A test asks for the permission itself, so only a browser that can't or
 * won't give it (or a list still being read) keeps the button off. */
function canTest(status: MediaDevicesStatus): boolean {
  return status === 'ready' || status === 'permission-needed';
}

function VolumeField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  const percent = Math.round(value * 100);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-body font-medium text-text-primary">{label}</span>
        <span className="text-label tabular-nums text-text-muted">{percent}%</span>
      </div>
      <Slider
        aria-label={label}
        value={[percent]}
        onValueChange={(v) => onChange((Array.isArray(v) ? (v[0] ?? 0) : (v as number)) / 100)}
        min={0}
        max={100}
      />
    </div>
  );
}

export function AudioVideoSettings() {
  const { t } = useTranslation('settings');
  const { t: tCalls } = useTranslation('calls');
  const {
    livekitRoom, mirrorCameraPreview, setMirrorCameraPreview,
    showTileBanners, setShowTileBanners, showStats, setShowStats, hideAudioOnlyTiles, setHideAudioOnlyTiles,
  } = useRoom();
  const mic = useMediaDevices(livekitRoom, 'audioinput');
  const speaker = useMediaDevices(livekitRoom, 'audiooutput');
  const camera = useMediaDevices(livekitRoom, 'videoinput');
  const { inputVolume, outputVolume, inputProfile } = useAudioPreferences();

  // Same as the call's own menus: saved for the next call, and applied to the
  // one in progress right away.
  function changeInputVolume(value: number) {
    setAudioPreference('inputVolume', value);
    const track = livekitRoom.localParticipant.getTrackPublication(Track.Source.Microphone)?.track as LocalAudioTrack | undefined;
    if (track) applyInputGain(track, value).catch((err) => log.warn('Failed to apply the input volume', { err: String(err) }));
  }
  function changeInputProfile(profile: InputProfile) {
    setAudioPreference('inputProfile', profile);
    applyInputProfile(livekitRoom, profile).catch((err) => log.warn('Failed to apply the input profile', { err: String(err) }));
  }

  return (
    <SettingsSections>
      <SettingsSection id="voice" title={t('catalog.sections.voice')}>
        <div className="grid grid-cols-1 gap-x-6 gap-y-6 @[560px]:grid-cols-2">
          <DeviceSelect label={t('av.microphone')} devices={mic} icon={<MicrophoneIcon size={18} />} />
          <DeviceSelect label={t('av.speaker')} devices={speaker} icon={<HeadphonesIcon size={18} />} />
          <VolumeField label={t('av.micVolume')} value={inputVolume} onChange={changeInputVolume} />
          <VolumeField label={t('av.speakerVolume')} value={outputVolume} onChange={(value) => setAudioPreference('outputVolume', value)} />
        </div>
        <MicTest deviceId={mic.activeDeviceId} disabled={!canTest(mic.status)} onStarted={mic.status === 'permission-needed' ? () => void mic.requestPermission() : undefined} />
        <p className="text-label text-text-muted">
          {t('av.switchHelp')}{' '}
          {speaker.status === 'ready' && <SpeakerTestLink deviceId={speaker.activeDeviceId} />}
        </p>
        <SettingsDivider />
        <div id="input-profile" tabIndex={-1} className="flex scroll-mt-10 flex-col gap-4 outline-none">
          <SettingsSubheading>{t('av.inputProfile')}</SettingsSubheading>
          <SettingsRadioGroup
            label={t('av.inputProfile')}
            value={inputProfile}
            onChange={changeInputProfile}
            options={INPUT_PROFILES.map((profile) => ({
              value: profile,
              label: tCalls(`devices.profiles.${profile}.label`),
              description: tCalls(`devices.profiles.${profile}.description`),
            }))}
          />
        </div>
      </SettingsSection>

      <SettingsSection id="video" title={t('catalog.sections.video')}>
        <DeviceSelect label={t('av.camera')} devices={camera} icon={<VideoCameraIcon size={18} />} />
        <CameraPreview deviceId={camera.activeDeviceId} mirrored={mirrorCameraPreview} disabled={!canTest(camera.status)} onStarted={camera.status === 'permission-needed' ? () => void camera.requestPermission() : undefined} />
        <SettingsRow label={t('av.mirror.label')} description={t('av.mirror.description')}>
          <Switch size="lg" checked={mirrorCameraPreview} onCheckedChange={setMirrorCameraPreview} aria-label={t('av.mirror.label')} />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection id="calls" title={t('catalog.sections.calls')}>
        <SettingsRow label={t('calls.banners.label')} description={t('calls.banners.description')}>
          <Switch size="lg" checked={showTileBanners} onCheckedChange={setShowTileBanners} aria-label={t('calls.banners.aria')} />
        </SettingsRow>
        <SettingsRow label={t('calls.hideAudioOnly.label')} description={t('calls.hideAudioOnly.description')}>
          <Switch size="lg" checked={hideAudioOnlyTiles} onCheckedChange={setHideAudioOnlyTiles} aria-label={t('calls.hideAudioOnly.label')} />
        </SettingsRow>
        <SettingsRow label={t('calls.stats.label')} description={t('calls.stats.description')}>
          <Switch size="lg" checked={showStats} onCheckedChange={setShowStats} aria-label={t('calls.stats.label')} />
        </SettingsRow>
      </SettingsSection>
    </SettingsSections>
  );
}
