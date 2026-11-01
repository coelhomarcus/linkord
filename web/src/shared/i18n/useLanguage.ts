import { useTranslation } from 'react-i18next';
import { DEFAULT_LANGUAGE, isLanguage, type Language } from './languages';

/** The language the UI is rendered in right now. */
export function useLanguage(): Language {
  const { i18n } = useTranslation();
  return isLanguage(i18n.language) ? i18n.language : DEFAULT_LANGUAGE;
}
