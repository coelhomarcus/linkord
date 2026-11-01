import { useState } from 'react';
import { updateLocale } from '@/shared/api/api';
import { applyLanguage } from '@/shared/i18n/applyLanguage';
import type { Language } from '@/shared/i18n/languages';
import { useLanguage } from '@/shared/i18n/useLanguage';

export function useLanguageSetting() {
  const language = useLanguage();
  const [saveFailed, setSaveFailed] = useState(false);

  // Applies at once and rolls back if the account can't store it, so the UI
  // never shows a language the other devices won't get.
  async function setLanguage(next: Language) {
    const previous = language;
    setSaveFailed(false);
    await applyLanguage(next);
    try {
      await updateLocale(next);
    } catch {
      await applyLanguage(previous);
      setSaveFailed(true);
    }
  }

  return { language, setLanguage, saveFailed };
}
