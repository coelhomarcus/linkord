import { DashboardIcon, FileArchiveIcon, FlagIcon, HardDrivesIcon, ScrollIcon, SquaresFourIcon, UsersIcon, WebhooksLogoIcon, type IconComponent } from '@/shared/ui/icons';
import type ptBR from './locales/pt-BR.json';

type NavKey = `nav.${keyof typeof ptBR.nav}`;

export interface AdminSection {
  id: 'overview' | 'users' | 'servers' | 'webhooks' | 'reports' | 'audit' | 'system' | 'backup';
  labelKey: NavKey;
  icon: IconComponent;
}

interface AdminGroup {
  labelKey: NavKey;
  sections: AdminSection[];
}

const OVERVIEW: AdminSection = { id: 'overview', labelKey: 'nav.overview', icon: DashboardIcon };
export const ADMIN_GROUPS: AdminGroup[] = [
  { labelKey: 'nav.workspace', sections: [OVERVIEW] },
  {
    labelKey: 'nav.management',
    sections: [
      { id: 'users', labelKey: 'nav.users', icon: UsersIcon },
      { id: 'servers', labelKey: 'nav.servers', icon: SquaresFourIcon },
      { id: 'webhooks', labelKey: 'nav.webhooks', icon: WebhooksLogoIcon },
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
      { id: 'backup', labelKey: 'nav.backup', icon: FileArchiveIcon },
    ],
  },
];

export const ADMIN_PATH = '/admin';

export function adminSectionPath(section: AdminSection): string {
  return section.id === 'overview' ? ADMIN_PATH : `${ADMIN_PATH}/${section.id}`;
}

/** A detail page belongs to the same section as its list. */
export function sectionForPath(pathname: string): AdminSection | null {
  const segment = pathname.split('/')[2];
  if (!segment) return OVERVIEW;
  for (const group of ADMIN_GROUPS) {
    const found = group.sections.find((section) => section.id === segment && section.id !== 'overview');
    if (found) return found;
  }
  return null;
}
