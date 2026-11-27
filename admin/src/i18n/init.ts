import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { DEFAULT_LANGUAGE, LANGUAGES, type Language } from './languages';
import { resolveInitialLanguage } from './languagePreference';
import commonEn from './locales/en-US.json';
import commonPt from './locales/pt-BR.json';
import adminEn from '@/features/admin/locales/en-US.json';
import adminPt from '@/features/admin/locales/pt-BR.json';
import authEn from '@/features/auth/locales/en-US.json';
import authPt from '@/features/auth/locales/pt-BR.json';
import reportsEn from '@/features/reports/locales/en-US.json';
import reportsPt from '@/features/reports/locales/pt-BR.json';
import badgesEn from '@/features/badges/locales/en-US.json';
import badgesPt from '@/features/badges/locales/pt-BR.json';

export const resources = {
  'en-US': { common: commonEn, admin: adminEn, auth: authEn, reports: reportsEn, badges: badgesEn },
  'pt-BR': { common: commonPt, admin: adminPt, auth: authPt, reports: reportsPt, badges: badgesPt },
};

export function initI18n(language: Language = resolveInitialLanguage()): void {
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
