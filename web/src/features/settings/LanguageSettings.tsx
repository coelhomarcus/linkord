import { useTranslation } from 'react-i18next';
import { ErrorBanner } from '@/shared/ErrorBanner';
import { LANGUAGES, isLanguage } from '@/shared/i18n/languages';
import { TIME_FORMATS, setTimeFormat, timeOptions, useTimeFormat } from '@/shared/lib/timeFormat';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/primitives/select';
import { SettingsRadioGroup, SettingsSection, SettingsSections } from './SettingsLayout';
import { useLanguageSetting } from './useLanguageSetting';

// an afternoon time, so 12 and 24 hours read differently
const SAMPLE_TIME = new Date(2026, 0, 1, 14, 30);

/** The language in the language now on screen ("Portuguese (Brazil)"), beside its own name. */
function displayName(code: string, uiLanguage: string): string {
  try {
    const name = new Intl.DisplayNames([uiLanguage], { type: 'language' }).of(code) ?? code;
    return name.charAt(0).toLocaleUpperCase(uiLanguage) + name.slice(1);
  } catch {
    return code;
  }
}

export function LanguageSettings() {
  const { t, i18n } = useTranslation('settings');
  const { language, setLanguage, saveFailed } = useLanguageSetting();
  const timeFormat = useTimeFormat();
  const nativeName = (code: string) => LANGUAGES.find((entry) => entry.code === code)?.nativeName ?? code;
  const example = (format: typeof timeFormat) => SAMPLE_TIME.toLocaleTimeString(i18n.language, timeOptions(i18n.language, format));

  return (
    <SettingsSections>
      <SettingsSection id="language" title={t('catalog.sections.language')} contentClassName="gap-3">
        <div>
          <p className="text-body font-medium text-text-primary">{t('language.label')}</p>
          <p className="mt-1 text-label text-text-muted">{t('language.description')}</p>
        </div>
        <Select value={language} onValueChange={(value) => { if (isLanguage(value)) void setLanguage(value); }}>
          <SelectTrigger aria-label={t('language.label')} className="h-11 w-full text-body">
            <SelectValue>
              {() => (
                <span className="flex w-full min-w-0 items-center justify-between gap-3">
                  <span className="truncate">{nativeName(language)}</span>
                  <span className="truncate text-text-muted">{displayName(language, i18n.language)}</span>
                </span>
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {LANGUAGES.map((entry) => (
              <SelectItem key={entry.code} value={entry.code}>{entry.nativeName}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {saveFailed && <ErrorBanner>{t('language.saveFailed')}</ErrorBanner>}
      </SettingsSection>

      <SettingsSection id="time-format" title={t('catalog.sections.timeFormat')}>
        <SettingsRadioGroup
          label={t('catalog.sections.timeFormat')}
          value={timeFormat}
          onChange={setTimeFormat}
          options={TIME_FORMATS.map((format) => ({
            value: format,
            label: t(`timeFormat.${format}.label`),
            description: t(`timeFormat.${format}.description`, { example: example(format) }),
          }))}
        />
      </SettingsSection>
    </SettingsSections>
  );
}
