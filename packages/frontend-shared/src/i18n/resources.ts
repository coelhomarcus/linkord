import commonEn from './locales/en-US.json';
import commonPt from './locales/pt-BR.json';
import authEn from '../auth/locales/en-US.json';
import authPt from '../auth/locales/pt-BR.json';
import reportsEn from '../reports/locales/en-US.json';
import reportsPt from '../reports/locales/pt-BR.json';

export const sharedResources = {
  'en-US': { common: commonEn, auth: authEn, reports: reportsEn },
  'pt-BR': { common: commonPt, auth: authPt, reports: reportsPt },
};
