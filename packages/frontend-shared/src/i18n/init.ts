import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { DEFAULT_LANGUAGE, LANGUAGES, type Language } from './languages';
import { resolveInitialLanguage } from './languagePreference';

export type LocaleBundle = Record<string, unknown>;
export type Resources = Record<string, Record<string, LocaleBundle>>;

/** `language` is explicit in tests, which must not depend on the (jsdom)
 * browser language. Strings are bundled, so init completes synchronously. */
export function initTranslations(resources: Resources, language: Language = resolveInitialLanguage()): void {
  void i18next.use(initReactI18next).init({
    resources,
    lng: language,
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: LANGUAGES.map((entry) => entry.code),
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    initAsync: false,
    returnNull: false,
  });
  document.documentElement.lang = language;
}

i18next.on('languageChanged', (language) => {
  document.documentElement.lang = language;
});

export { i18next as i18n };
