import { DEFAULT_LANGUAGE, isLanguage, matchLanguage, type Language } from './languages';

const LANGUAGE_KEY = 'ss-locale';

/** The last language this browser was told to use — kept locally so the login
 * page and the first paint after a reload are right before /me answers. */
export function loadStoredLanguage(): Language | null {
  try {
    const stored = localStorage.getItem(LANGUAGE_KEY);
    return isLanguage(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function saveStoredLanguage(language: Language): void {
  try {
    localStorage.setItem(LANGUAGE_KEY, language);
  } catch {
    // private mode / blocked storage: the account value still wins once logged in
  }
}

/** What to show before the account's own preference is known. */
export function resolveInitialLanguage(): Language {
  return loadStoredLanguage() ?? matchLanguage(navigator.languages ?? [navigator.language]) ?? DEFAULT_LANGUAGE;
}
