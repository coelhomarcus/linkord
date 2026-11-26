import 'i18next';
import type common from '@overcord/frontend-shared/i18n/locales/pt-BR.json';
import type auth from '@overcord/frontend-shared/auth/locales/pt-BR.json';
import type reports from '@overcord/frontend-shared/reports/locales/pt-BR.json';
import type admin from '@/features/admin/locales/pt-BR.json';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: { common: typeof common; auth: typeof auth; reports: typeof reports; admin: typeof admin };
  }
}
