import { useTranslation } from 'react-i18next';
import { ErrorBanner } from '@/shared/ErrorBanner';
import { LANGUAGES, isLanguage } from '@/shared/i18n/languages';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/primitives/select';
import { SettingsRow, SettingsSection } from './SettingsLayout';
import { useLanguageSetting } from './useLanguageSetting';

export function LanguageSetting() {
  const { t } = useTranslation('settings');
  const { language, setLanguage, saveFailed } = useLanguageSetting();
  const nativeName = (code: string) => LANGUAGES.find((entry) => entry.code === code)?.nativeName ?? code;

  return (
    <SettingsSection id="language" title={t('language.label')}>
      <SettingsRow label={t('language.label')} description={t('language.description')}>
        <Select value={language} onValueChange={(value) => { if (isLanguage(value)) void setLanguage(value); }}>
          <SelectTrigger aria-label={t('language.label')} className="w-full max-w-xs">
            <SelectValue>{() => nativeName(language)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {LANGUAGES.map((entry) => (
              <SelectItem key={entry.code} value={entry.code}>{entry.nativeName}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>
      {saveFailed && <ErrorBanner>{t('language.saveFailed')}</ErrorBanner>}
    </SettingsSection>
  );
}
