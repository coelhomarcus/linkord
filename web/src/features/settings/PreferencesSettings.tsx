import { useTranslation } from 'react-i18next';
import { useRoom } from '@/state/RoomContext';
import { Switch } from '@/shared/ui/primitives/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/primitives/select';
import { SettingsRow, SettingsSection, SettingsSections } from './SettingsLayout';
import { COLOR_THEME_IDS, COLOR_THEME_LABELS, type ColorThemeId } from './useColorThemePreference';

export function PreferencesSettings() {
  const { t } = useTranslation('settings');
  const {
    colorTheme, setColorTheme,
    showTileBanners, setShowTileBanners, showStats, setShowStats,
    hideAudioOnlyTiles, setHideAudioOnlyTiles, compressImagesDefault, setCompressImagesDefault,
  } = useRoom();

  return (
    <SettingsSections>
      <SettingsSection id="app-appearance" title={t('catalog.sections.appAppearance')}>
        <SettingsRow
          label={t('prefs.theme.label')}
          description={t('prefs.theme.description')}
        >
          <Select value={colorTheme} onValueChange={(value) => value && setColorTheme(value as ColorThemeId)}>
            <SelectTrigger aria-label={t('prefs.theme.label')} className="w-full max-w-xs">
              <SelectValue>{() => COLOR_THEME_LABELS[colorTheme]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {COLOR_THEME_IDS.map((id) => (
                <SelectItem key={id} value={id}>
                  {COLOR_THEME_LABELS[id]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection id="call-appearance" title={t('catalog.sections.callAppearance')}>
        <SettingsRow label={t('prefs.banners.label')} description={t('prefs.banners.description')}>
          <Switch checked={showTileBanners} onCheckedChange={setShowTileBanners} aria-label={t('prefs.banners.aria')} />
        </SettingsRow>
        <SettingsRow label={t('prefs.hideAudioOnly.label')} description={t('prefs.hideAudioOnly.description')}>
          <Switch checked={hideAudioOnlyTiles} onCheckedChange={setHideAudioOnlyTiles} aria-label={t('prefs.hideAudioOnly.label')} />
        </SettingsRow>
        <SettingsRow label={t('prefs.stats.label')} description={t('prefs.stats.description')}>
          <Switch checked={showStats} onCheckedChange={setShowStats} aria-label={t('prefs.stats.label')} />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection id="image-uploads" title={t('catalog.sections.imageUploads')}>
        <SettingsRow label={t('prefs.compress.label')} description={t('prefs.compress.description')}>
          <Switch checked={compressImagesDefault} onCheckedChange={setCompressImagesDefault} aria-label={t('prefs.compress.label')} />
        </SettingsRow>
      </SettingsSection>
    </SettingsSections>
  );
}
