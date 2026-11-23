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

  it('groups the categories by what they are about, in a fixed order', () => {
    const groups = (isAdmin: boolean, isDesktop: boolean) => visibleGroups(isAdmin, isDesktop).map((group) => ({
      heading: group.labelKey,
      ids: group.categories.map((category) => category.id),
    }));
    expect(groups(true, true)).toEqual([
      { heading: 'catalog.groups.account', ids: ['account', 'security', 'privacy'] },
      { heading: 'catalog.groups.social', ids: ['connections', 'activity'] },
      { heading: 'catalog.groups.display', ids: ['appearance', 'language'] },
      { heading: 'catalog.groups.communication', ids: ['av', 'chat', 'notifications'] },
      { heading: 'catalog.groups.app', ids: ['desktop', 'downloads'] },
      { heading: 'catalog.groups.admin', ids: ['moderation'] },
    ]);
  });

  it('hides the administration heading from everyone else, and keeps the app heading for the download page on the web', () => {
    const headings = visibleGroups(false, false).map((group) => group.labelKey);
    expect(headings).not.toContain('catalog.groups.admin');
    expect(visibleGroups(false, false).find((group) => group.labelKey === 'catalog.groups.app')?.categories.map((category) => category.id)).toEqual(['downloads']);
  });

  it('keeps every public category id, so old links still open the same page', () => {
    const ids = SETTINGS_GROUPS.flatMap((group) => group.categories.map((category) => category.id));
    expect([...ids].sort()).toEqual(['account', 'activity', 'av', 'chat', 'connections', 'desktop', 'downloads', 'language', 'moderation', 'notifications', 'privacy', 'security', 'appearance'].sort());
  });
});
