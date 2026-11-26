import commonEn from './locales/en-US.json';
import commonPt from './locales/pt-BR.json';
import authEn from '../auth/locales/en-US.json';
import authPt from '../auth/locales/pt-BR.json';
import reportsEn from '../reports/locales/en-US.json';
import reportsPt from '../reports/locales/pt-BR.json';
import badgesEn from '../badges/locales/en-US.json';
import badgesPt from '../badges/locales/pt-BR.json';

export const sharedResources = {
  'en-US': { common: commonEn, auth: authEn, reports: reportsEn, badges: badgesEn },
  'pt-BR': { common: commonPt, auth: authPt, reports: reportsPt, badges: badgesPt },
};
