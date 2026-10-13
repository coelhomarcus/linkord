import { Flag, ScrollText } from 'lucide-react';
import { Server, Users, UsersRound } from '@/shared/ui/icons';
import type { IconComponent } from '@/shared/ui/icons';

export interface AdminSection {
  /** first path segment under /admin */
  id: 'users' | 'groups' | 'reports' | 'audit' | 'system';
  label: string;
  icon: IconComponent;
}

export interface AdminGroup {
  label: string;
  sections: AdminSection[];
}

// One catalog feeds the wide sidebar and the compact index, so the two can't
// drift apart. Ids are public URLs (/admin/:id): labels can change, ids can't.
export const ADMIN_GROUPS: AdminGroup[] = [
  {
    label: 'Gestão',
    sections: [
      { id: 'users', label: 'Usuários', icon: Users },
      { id: 'groups', label: 'Grupos', icon: UsersRound },
    ],
  },
  {
    label: 'Moderação',
    sections: [{ id: 'reports', label: 'Denúncias', icon: Flag }],
  },
  {
    label: 'Operação',
    sections: [
      { id: 'audit', label: 'Auditoria', icon: ScrollText },
      { id: 'system', label: 'Sistema', icon: Server },
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
