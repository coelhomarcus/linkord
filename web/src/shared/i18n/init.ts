import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { DEFAULT_LANGUAGE, LANGUAGES, type Language } from './languages';
import { resolveInitialLanguage } from './languagePreference';
import commonEn from './locales/en-US.json';
import commonPt from './locales/pt-BR.json';

type LocaleBundle = Record<string, unknown>;
type Resources = Record<string, Record<string, LocaleBundle>>;

const modules = import.meta.glob<LocaleBundle>('/src/features/*/locales/*.json', { eager: true, import: 'default' });

export function initI18n(language: Language = resolveInitialLanguage()): void {
  const resources: Resources = {
    'en-US': { common: commonEn },
    'pt-BR': { common: commonPt },
  };
  for (const [path, bundle] of Object.entries(modules)) {
    const match = /^\/src\/features\/([^/]+)\/locales\/([^/]+)\.json$/.exec(path);
    if (match) (resources[match[2]!] ??= {})[match[1]!] = bundle;
  }
  void i18n.use(initReactI18next).init({
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

i18n.on('languageChanged', (language) => {
  document.documentElement.lang = language;
});

export { i18n };
