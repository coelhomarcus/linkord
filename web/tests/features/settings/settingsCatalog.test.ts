import { describe, expect, it } from 'vitest';
import { SETTINGS_GROUPS } from '@/features/settings/settingsCatalog';
import { SETTINGS_SEARCH_INDEX } from '@/features/settings/settingsSearchIndex';

describe('settings catalog sections', () => {
  it('every section the sidebar lists is one a search result can land on', () => {
    const searchable = new Set(SETTINGS_SEARCH_INDEX.flatMap((entry) => (entry.sectionId ? [`${entry.categoryId}#${entry.sectionId}`] : [])));
    const listed = SETTINGS_GROUPS.flatMap((group) => group.categories.flatMap((category) => (category.sections ?? []).map((section) => `${category.id}#${section.id}`)));
    expect(listed.length).toBeGreaterThan(0);
    for (const key of listed) expect(searchable, key).toContain(key);
  });
});
