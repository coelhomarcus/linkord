import 'i18next';
import type common from './locales/pt-BR.json';

// pt-BR is the source of truth for key names: other languages are checked
// against it by tests/shared/i18n/localeParity.test.ts. A feature that moves
// to i18n adds its namespace to `resources` below.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: {
      common: typeof common;
    };
  }
}
