import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useInstall } from '@/features/install/installPrompt';
import { findCategory } from './settingsCatalog';
import { SETTINGS_SEARCH_INDEX } from './settingsSearchIndex';
import type { SearchEntry } from './settingsSearchIndex';

/** Normalize accents and case so queries match localized labels. */
export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

export interface SettingsSearchResult {
  entry: SearchEntry;
  title: string;
  categoryLabel: string;
}

export function useSettingsSearch(isAdmin: boolean) {
  const { t } = useTranslation('settings');
  const [query, setQuery] = useState('');
  const canInstall = useInstall().method !== null;

  const visibleEntries = useMemo(
    () => SETTINGS_SEARCH_INDEX.filter((entry) => (isAdmin || !entry.adminOnly) && (canInstall || !entry.requiresInstall)),
    [isAdmin, canInstall],
  );

  const results = useMemo((): SettingsSearchResult[] => {
    const q = normalizeSearchText(query);
    if (!q) return [];
    return visibleEntries
      .map((entry) => ({
        entry,
        title: t(`search.${entry.searchKey}.title`),
        categoryLabel: t(findCategory(entry.categoryId).labelKey),
        keywords: t(`search.${entry.searchKey}.keywords`),
      }))
      .filter(({ title, categoryLabel, keywords }) => normalizeSearchText([title, categoryLabel, keywords].join(' ')).includes(q))
      .map(({ entry, title, categoryLabel }) => ({ entry, title, categoryLabel }));
  }, [query, visibleEntries, t]);

  return { query, setQuery, results };
}
