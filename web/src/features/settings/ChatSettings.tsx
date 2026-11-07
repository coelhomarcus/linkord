import { useTranslation } from 'react-i18next';
import { useRoom } from '@/state/RoomContext';
import { Switch } from '@/shared/ui/primitives/switch';
import { SettingsRow, SettingsSection, SettingsSections } from './SettingsLayout';

export function ChatSettings() {
  const { t } = useTranslation('settings');
  const { compressImagesDefault, setCompressImagesDefault } = useRoom();
  return (
    <SettingsSections>
      <SettingsSection id="uploads" title={t('catalog.sections.uploads')}>
        <SettingsRow label={t('chat.compress.label')} description={t('chat.compress.description')}>
          <Switch size="lg" checked={compressImagesDefault} onCheckedChange={setCompressImagesDefault} aria-label={t('chat.compress.label')} />
        </SettingsRow>
      </SettingsSection>
    </SettingsSections>
  );
}
