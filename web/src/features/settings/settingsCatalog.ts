import type { ParseKeys } from 'i18next';
import { BellIcon, ChatCircleTextIcon, DesktopIcon, DownloadSimpleIcon, GameControllerIcon, IdentificationCardIcon, KeyIcon, LockIcon, MicrophoneIcon, PaintBrushIcon, PlugsConnectedIcon, ShieldCheckIcon, TranslateIcon, type IconComponent } from '@/shared/ui/icons';

import type { SettingsTab } from '@/shared/lib/routes';

/** An i18n key of the `settings` namespace. */
type SettingsKey = ParseKeys<'settings'>;

export interface SettingsCategory {
  id: SettingsTab;
  labelKey: SettingsKey;
  icon: IconComponent;
  adminOnly?: boolean;
  /** only inside the desktop app, which has settings of its own */
  desktopOnly?: boolean;
}

export interface SettingsGroup {
  labelKey: SettingsKey;
  categories: SettingsCategory[];
}

// One catalog feeds the desktop sidebar and the compact index, so the two can't
// drift apart. Ids are the public URLs (/app/settings/:id): labels can change,
// ids can't (a retired id goes to LEGACY_SETTINGS_TABS). Labels are i18n keys,
// resolved where they are rendered so a language switch needs no reload.
export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    labelKey: 'catalog.groups.account',
    categories: [
      { id: 'account', labelKey: 'catalog.categories.account', icon: IdentificationCardIcon },
      { id: 'security', labelKey: 'catalog.categories.security', icon: KeyIcon },
      { id: 'privacy', labelKey: 'catalog.categories.privacy', icon: LockIcon },
    ],
  },
  {
    labelKey: 'catalog.groups.social',
    categories: [
      { id: 'connections', labelKey: 'catalog.categories.connections', icon: PlugsConnectedIcon },
      { id: 'activity', labelKey: 'catalog.categories.activity', icon: GameControllerIcon },
    ],
  },
  {
    labelKey: 'catalog.groups.display',
    categories: [
      { id: 'appearance', labelKey: 'catalog.categories.appearance', icon: PaintBrushIcon },
      { id: 'language', labelKey: 'catalog.categories.language', icon: TranslateIcon },
    ],
  },
  {
    labelKey: 'catalog.groups.communication',
    categories: [
      { id: 'av', labelKey: 'catalog.categories.av', icon: MicrophoneIcon },
      { id: 'chat', labelKey: 'catalog.categories.chat', icon: ChatCircleTextIcon },
      { id: 'notifications', labelKey: 'catalog.categories.notifications', icon: BellIcon },
    ],
  },
  {
    labelKey: 'catalog.groups.app',
    categories: [
      { id: 'desktop', labelKey: 'catalog.categories.desktop', icon: DesktopIcon, desktopOnly: true },
      { id: 'downloads', labelKey: 'catalog.categories.downloads', icon: DownloadSimpleIcon },
    ],
  },
  {
    labelKey: 'catalog.groups.admin',
    categories: [
      { id: 'moderation', labelKey: 'catalog.categories.moderation', icon: ShieldCheckIcon, adminOnly: true },
    ],
  },
];

/** Whether this page may show a category: admin-only ones to admins, desktop-only ones in the desktop app. */
export function categoryVisible(category: Pick<SettingsCategory, 'adminOnly' | 'desktopOnly'>, isAdmin: boolean, isDesktop: boolean): boolean {
  return (isAdmin || !category.adminOnly) && (isDesktop || !category.desktopOnly);
}

/** The groups this account may see here. */
export function visibleGroups(isAdmin: boolean, isDesktop: boolean): SettingsGroup[] {
  return SETTINGS_GROUPS
    .map((group) => ({ ...group, categories: group.categories.filter((category) => categoryVisible(category, isAdmin, isDesktop)) }))
    .filter((group) => group.categories.length > 0);
}

export function findCategory(id: SettingsTab): SettingsCategory {
  for (const group of SETTINGS_GROUPS) {
    const found = group.categories.find((category) => category.id === id);
    if (found) return found;
  }
  throw new Error(`unknown settings category: ${id}`);
}

/** Carried by a link that leaves the compact index, so "back" can return to the
 * previous history entry instead of pushing the index again. */
export const FROM_INDEX_STATE = { fromIndex: true } as const;
