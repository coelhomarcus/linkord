import { useTranslation } from 'react-i18next';
import { useRoom } from '@/state/RoomContext';
import { DevicePicker } from './DevicePicker';
import { SettingsSection, SettingsSections } from './SettingsLayout';

export function AudioVideoSettings() {
  const { t } = useTranslation('settings');
  const { livekitRoom } = useRoom();

  return (
    <SettingsSections>
      <SettingsSection id="microphone" title={t('catalog.sections.microphone')}>
        <DevicePicker label={t('av.microphone')} room={livekitRoom} kind="audioinput" />
      </SettingsSection>

      <SettingsSection id="speaker" title={t('catalog.sections.speaker')}>
        <DevicePicker label={t('av.speaker')} room={livekitRoom} kind="audiooutput" />
      </SettingsSection>

      <SettingsSection id="camera" title={t('catalog.sections.camera')}>
        <DevicePicker label={t('av.camera')} room={livekitRoom} kind="videoinput" />
      </SettingsSection>
    </SettingsSections>
  );
}
