import type { Language } from './languages';
import { saveStoredLanguage } from './languagePreference';
import { i18n } from './init';

/** Switches the UI language and remembers it for the next visit on this
 * browser. Does not talk to the server — that is the caller's job. */
export async function applyLanguage(language: Language): Promise<void> {
  saveStoredLanguage(language);
  if (i18n.language !== language) await i18n.changeLanguage(language);
}
