import { initTranslations, type LocaleBundle, type Resources } from '@overcord/frontend-shared/i18n/init';
import { sharedResources } from '@overcord/frontend-shared/i18n/resources';
import type { Language } from '@/shared/i18n/languages';

const modules = import.meta.glob<LocaleBundle>('/src/features/*/locales/*.json', { eager: true, import: 'default' });

export function initI18n(language?: Language): void {
  const resources: Resources = {
    'en-US': { ...sharedResources['en-US'] },
    'pt-BR': { ...sharedResources['pt-BR'] },
  };
  for (const [path, bundle] of Object.entries(modules)) {
    const match = /^\/src\/features\/([^/]+)\/locales\/([^/]+)\.json$/.exec(path);
    if (match) (resources[match[2]!] ??= {})[match[1]!] = bundle;
  }
  initTranslations(resources, language);
}

export { default as i18n } from 'i18next';
