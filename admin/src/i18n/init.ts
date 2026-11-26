import { initTranslations } from '@linkord/frontend-shared/i18n/init';
import { sharedResources } from '@linkord/frontend-shared/i18n/resources';
import type { Language } from '@linkord/frontend-shared/i18n/languages';
import adminEn from '@/features/admin/locales/en-US.json';
import adminPt from '@/features/admin/locales/pt-BR.json';

export function initI18n(language?: Language): void {
  initTranslations({
    'en-US': { ...sharedResources['en-US'], admin: adminEn },
    'pt-BR': { ...sharedResources['pt-BR'], admin: adminPt },
  }, language);
}
