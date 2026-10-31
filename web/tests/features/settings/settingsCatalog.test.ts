import { describe, expect, it } from 'vitest';
import { SETTINGS_GROUPS, visibleGroups } from '@/features/settings/settingsCatalog';

describe('settings catalog', () => {
  it('gives every category its own icon, so the sidebar items can be told apart', () => {
    const icons = SETTINGS_GROUPS.flatMap((group) => group.categories.map((category) => category.icon));
    expect(new Set(icons).size).toBe(icons.length);
  });

  it('lists the profile as the first item of the first group', () => {
    expect(visibleGroups(false)[0]?.categories[0]?.id).toBe('profile');
  });
});
