// The languages an account can pick. Mirrors web/src/shared/i18n/languages.ts
// — server/tests/modules/users/locale.test.ts fails if the two drift apart.
export const LOCALES = ['pt-BR', 'en-US'] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'pt-BR';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** Anything unrecognized (a missing field, a language dropped from the list
 * after rows were written) reads as the default, never as an error. */
export function resolveLocale(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}
