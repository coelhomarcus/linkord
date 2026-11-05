import type { ParseKeys } from 'i18next';
import { BellIcon, GearSixIcon, HeadphonesIcon, IdentificationCardIcon, LockIcon, ShieldCheckIcon, UserIcon } from '@phosphor-icons/react';

import type { IconComponent } from '@/shared/ui/icons';
import type { SettingsTab } from '@/shared/lib/routes';

/** An i18n key of the `settings` namespace. */
type SettingsKey = ParseKeys<'settings'>;

/** A titled block of a category: `id` is the `<SettingsSection id>` it points at. */
interface SettingsSectionRef {
  id: string;
  labelKey: SettingsKey;
}

export interface SettingsCategory {
  id: SettingsTab;
  labelKey: SettingsKey;
  /** one line under the page title */
  descriptionKey: SettingsKey;
  icon: IconComponent;
  adminOnly?: boolean;
  sections?: SettingsSectionRef[];
}

export interface SettingsGroup {
  labelKey: SettingsKey;
  categories: SettingsCategory[];
}

// One catalog feeds the desktop sidebar and the compact index, so the two can't
// drift apart. Ids are the public URLs (/app/settings/:id): labels can change,
// ids can't. Labels are i18n keys, resolved where they are rendered so a
// language switch needs no reload.
export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    labelKey: 'catalog.groups.you',
    categories: [
      { id: 'profile', labelKey: 'catalog.categories.profile.label', descriptionKey: 'catalog.categories.profile.description', icon: UserIcon },
      { id: 'account', labelKey: 'catalog.categories.account.label', descriptionKey: 'catalog.categories.account.description', icon: IdentificationCardIcon,
        sections: [
          { id: 'identity', labelKey: 'catalog.sections.identity' },
          { id: 'language', labelKey: 'catalog.sections.language' },
          { id: 'email', labelKey: 'catalog.sections.email' },
          { id: 'storage', labelKey: 'catalog.sections.storage' },
          { id: 'session', labelKey: 'catalog.sections.session' },
        ] },
      { id: 'privacy', labelKey: 'catalog.categories.privacy.label', descriptionKey: 'catalog.categories.privacy.description', icon: LockIcon },
    ],
  },
  {
    labelKey: 'catalog.groups.app',
    categories: [
      { id: 'av', labelKey: 'catalog.categories.av.label', descriptionKey: 'catalog.categories.av.description', icon: HeadphonesIcon,
        sections: [
          { id: 'microphone', labelKey: 'catalog.sections.microphone' },
          { id: 'speaker', labelKey: 'catalog.sections.speaker' },
          { id: 'camera', labelKey: 'catalog.sections.camera' },
        ] },
      { id: 'notifications', labelKey: 'catalog.categories.notifications.label', descriptionKey: 'catalog.categories.notifications.description', icon: BellIcon,
        sections: [{ id: 'system', labelKey: 'catalog.sections.system' }, { id: 'sounds', labelKey: 'catalog.sections.sounds' }] },
      { id: 'prefs', labelKey: 'catalog.categories.prefs.label', descriptionKey: 'catalog.categories.prefs.description', icon: GearSixIcon,
        sections: [
          { id: 'app-appearance', labelKey: 'catalog.sections.appAppearance' },
          { id: 'call-appearance', labelKey: 'catalog.sections.callAppearance' },
          { id: 'image-uploads', labelKey: 'catalog.sections.imageUploads' },
        ] },
    ],
  },
  {
    labelKey: 'catalog.groups.admin',
    categories: [
      { id: 'moderation', labelKey: 'catalog.categories.moderation.label', descriptionKey: 'catalog.categories.moderation.description', icon: ShieldCheckIcon, adminOnly: true },
    ],
  },
];

/** The groups this account may see — an admin-only category is not listed for anyone else. */
export function visibleGroups(isAdmin: boolean): SettingsGroup[] {
  return SETTINGS_GROUPS
    .map((group) => ({ ...group, categories: group.categories.filter((category) => isAdmin || !category.adminOnly) }))
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
