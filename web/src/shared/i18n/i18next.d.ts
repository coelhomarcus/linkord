import 'i18next';
import type common from './locales/pt-BR.json';
import type auth from '@/features/auth/locales/pt-BR.json';
import type conversations from '@/features/conversations/locales/pt-BR.json';
import type navigation from '@/features/navigation/locales/pt-BR.json';
import type settings from '@/features/settings/locales/pt-BR.json';

// pt-BR is the source of truth for key names: other languages are checked
// against it by tests/shared/i18n/localeParity.test.ts. A feature that moves
// to i18n adds its namespace to `resources` below.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: {
      common: typeof common;
      auth: typeof auth;
      conversations: typeof conversations;
      navigation: typeof navigation;
      settings: typeof settings;
    };
  }
}
