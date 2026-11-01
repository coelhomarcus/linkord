import { FlagIcon, HardDrivesIcon, RobotIcon, ScrollIcon, UsersIcon } from '@phosphor-icons/react';

import type { IconComponent } from '@/shared/ui/icons';

export interface AdminSection {
  /** first path segment under /admin */
  id: 'users' | 'groups' | 'bots' | 'reports' | 'audit' | 'system';
  labelKey: string;
  icon: IconComponent;
}

export interface AdminGroup {
  labelKey: string;
  sections: AdminSection[];
}

// One catalog feeds the wide sidebar and the compact index, so the two can't
// drift apart. Ids are public URLs (/admin/:id): labels can change, ids can't.
export const ADMIN_GROUPS: AdminGroup[] = [
  {
    labelKey: 'nav.management',
    sections: [
      { id: 'users', labelKey: 'nav.users', icon: UsersIcon },
      { id: 'groups', labelKey: 'nav.groups', icon: UsersIcon },
      { id: 'bots', labelKey: 'nav.bots', icon: RobotIcon },
    ],
  },
  {
    labelKey: 'nav.moderation',
    sections: [{ id: 'reports', labelKey: 'nav.reports', icon: FlagIcon }],
  },
  {
    labelKey: 'nav.operations',
    sections: [
      { id: 'audit', labelKey: 'nav.audit', icon: ScrollIcon },
      { id: 'system', labelKey: 'nav.system', icon: HardDrivesIcon },
    ],
  },
];

export const ADMIN_PATH = '/admin';

export function adminSectionPath(section: AdminSection): string {
  return `${ADMIN_PATH}/${section.id}`;
}

/** The section a pathname belongs to — a detail page counts as its list's section. */
export function sectionForPath(pathname: string): AdminSection | null {
  const segment = pathname.split('/')[2];
  for (const group of ADMIN_GROUPS) {
    const found = group.sections.find((section) => section.id === segment);
    if (found) return found;
  }
  return null;
}
