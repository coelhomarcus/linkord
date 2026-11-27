import 'i18next';
import type common from './locales/pt-BR.json';
import type auth from '@/features/auth/locales/pt-BR.json';
import type reports from '@/features/reports/locales/pt-BR.json';
import type badges from '@/features/badges/locales/pt-BR.json';
import type admin from '@/features/admin/locales/pt-BR.json';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: { common: typeof common; auth: typeof auth; reports: typeof reports; badges: typeof badges; admin: typeof admin };
  }
}
