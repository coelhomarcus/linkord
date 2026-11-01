import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { DEFAULT_LANGUAGE, LANGUAGES, type Language } from './languages';
import { resolveInitialLanguage } from './languagePreference';

type Bundle = Record<string, unknown>;

// `shared/i18n/locales/<lang>.json` is the `common` namespace; every feature
// owns its strings in `features/<name>/locales/<lang>.json`, namespaced by
// the feature folder's name.
const modules = import.meta.glob<Bundle>(
  ['/src/shared/i18n/locales/*.json', '/src/features/*/locales/*.json'],
  { eager: true, import: 'default' },
);

function buildResources(): Record<string, Record<string, Bundle>> {
  const resources: Record<string, Record<string, Bundle>> = {};
  for (const [path, bundle] of Object.entries(modules)) {
    const match = /^\/src\/(?:shared\/i18n|features\/([^/]+))\/locales\/([^/]+)\.json$/.exec(path);
    if (!match) continue;
    const namespace = match[1] ?? 'common';
    const language = match[2]!;
    (resources[language] ??= {})[namespace] = bundle;
  }
  return resources;
}

/** `language` is explicit in tests, which must not depend on the (jsdom)
 * browser language. Strings are bundled, so init completes synchronously. */
export function initI18n(language: Language = resolveInitialLanguage()): void {
  void i18next.use(initReactI18next).init({
    resources: buildResources(),
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
