import { afterEach, describe, expect, it } from 'vitest';
import { matchLanguage } from '@/shared/i18n/languages';
import { loadStoredLanguage, resolveInitialLanguage, saveStoredLanguage } from '@/shared/i18n/languagePreference';
import { LOCAL_STORAGE_KEYS, localStorageStore } from '@/shared/lib/localStorage';

describe('matchLanguage', () => {
  it('matches a supported language exactly, ignoring case', () => {
    expect(matchLanguage(['EN-us'])).toBe('en-US');
  });

  it('falls back to the primary subtag, so pt-PT gets pt-BR and en-GB gets en-US', () => {
    expect(matchLanguage(['pt-PT'])).toBe('pt-BR');
    expect(matchLanguage(['en-GB'])).toBe('en-US');
  });

  it('follows the browser preference order and skips unsupported languages', () => {
    expect(matchLanguage(['fr-FR', 'en', 'pt-BR'])).toBe('en-US');
  });

  it('returns null when nothing matches', () => {
    expect(matchLanguage(['fr-FR', 'de'])).toBeNull();
    expect(matchLanguage([])).toBeNull();
  });
});

describe('resolveInitialLanguage', () => {
  afterEach(() => localStorage.clear());

  it('prefers the language this browser stored over the browser language', () => {
    saveStoredLanguage('pt-BR');
    expect(resolveInitialLanguage()).toBe('pt-BR');
  });

  it('uses the browser language on a first visit', () => {
    expect(loadStoredLanguage()).toBeNull();
    expect(resolveInitialLanguage()).toBe('en-US'); // jsdom's navigator.language
  });

  it('ignores a stored value that is no longer a supported language', () => {
    localStorageStore.set(LOCAL_STORAGE_KEYS.language, 'xx-XX');
    expect(loadStoredLanguage()).toBeNull();
  });
});
