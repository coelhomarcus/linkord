import { afterEach, beforeEach } from 'vitest';
import { i18n } from '@/shared/i18n/init';
import type { Language } from '@/shared/i18n/languages';

/** Renders every test in the enclosing `describe` in `language`, then puts the
 * suite's default (pt-BR) back. */
export function useLanguageForTests(language: Language): void {
  beforeEach(async () => { await i18n.changeLanguage(language); });
  afterEach(async () => { await i18n.changeLanguage('pt-BR'); });
}
