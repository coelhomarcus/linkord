// Adding a language: one entry here, plus a `<lang>.json` next to every
// existing `locales/pt-BR.json` (tests/shared/i18n/localeParity.test.ts fails
// until the keys match). The server keeps its own copy of this list in
// modules/users/locale.ts — server/tests/modules/users/locale.test.ts pins the two together.
export const LANGUAGES = [
  { code: 'pt-BR', nativeName: 'Português (Brasil)' },
  { code: 'en-US', nativeName: 'English (US)' },
] as const;

export type Language = (typeof LANGUAGES)[number]['code'];

export const DEFAULT_LANGUAGE: Language = 'pt-BR';

export function isLanguage(value: unknown): value is Language {
  return LANGUAGES.some((language) => language.code === value);
}

/** First candidate (in the browser's preference order) that matches a
 * supported language exactly or by its primary subtag, so `pt-PT` still gets
 * `pt-BR` rather than being skipped. */
export function matchLanguage(candidates: readonly string[]): Language | null {
  for (const candidate of candidates) {
    const tag = candidate.toLowerCase();
    const exact = LANGUAGES.find((language) => language.code.toLowerCase() === tag);
    if (exact) return exact.code;
    const primary = tag.split('-')[0];
    const loose = LANGUAGES.find((language) => language.code.toLowerCase().split('-')[0] === primary);
    if (loose) return loose.code;
  }
  return null;
}
