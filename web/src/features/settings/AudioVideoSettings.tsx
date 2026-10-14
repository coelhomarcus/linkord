import { useRoom } from '@/state/RoomContext';
import { DevicePicker } from './DevicePicker';
import { SettingsSection, SettingsSections } from './SettingsLayout';

export function AudioVideoSettings() {
  const { livekitRoom } = useRoom();

  return (
    <SettingsSections>
      <SettingsSection id="microphone" title="Entrada de áudio">
        <DevicePicker label="Microfone" room={livekitRoom} kind="audioinput" />
      </SettingsSection>

      <SettingsSection id="speaker" title="Saída de áudio">
        <DevicePicker label="Alto-falante" room={livekitRoom} kind="audiooutput" />
      </SettingsSection>

      <SettingsSection id="camera" title="Vídeo">
        <DevicePicker label="Câmera" room={livekitRoom} kind="videoinput" />
      </SettingsSection>
    </SettingsSections>
  );
}
