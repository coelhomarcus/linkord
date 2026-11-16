import { describe, expect, it } from 'vitest';
import { SETTINGS_GROUPS, visibleGroups } from '@/features/settings/settingsCatalog';

describe('settings catalog', () => {
  it('gives every category its own icon, so the sidebar items can be told apart', () => {
    const icons = SETTINGS_GROUPS.flatMap((group) => group.categories.map((category) => category.icon));
    expect(new Set(icons).size).toBe(icons.length);
  });

  it('opens with the account: the profile is edited in your own profile modal, not here', () => {
    const ids = visibleGroups(false, false).flatMap((group) => group.categories.map((category) => category.id));
    expect(ids[0]).toBe('account');
    expect(ids).not.toContain('profile');
  });

  it('lists the app\'s own settings only inside the desktop app', () => {
    const ids = (isDesktop: boolean) => visibleGroups(false, isDesktop).flatMap((group) => group.categories.map((category) => category.id));
    expect(ids(false)).not.toContain('desktop');
    expect(ids(true)).toContain('desktop');
  });

  it('gives connections their own category right after the account', () => {
    expect(visibleGroups(false, false)[0]?.categories.slice(0, 2).map((category) => category.id)).toEqual(['account', 'connections']);
  });

  it('gives activity its own category beside connections, the other thing shown on your profile', () => {
    expect(visibleGroups(false, false)[0]?.categories.map((category) => category.id)).toEqual(['account', 'connections', 'activity', 'privacy', 'security']);
  });
});
