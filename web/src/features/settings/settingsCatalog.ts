import { BellIcon, IdentificationCardIcon, LockIcon, ShieldCheckIcon, SlidersIcon, UserIcon } from '@phosphor-icons/react';

import type { IconComponent } from '@/shared/ui/icons';
import type { SettingsTab } from '@/shared/lib/routes';

/** A titled block of a category: `id` is the `<SettingsSection id>` it points at. */
export interface SettingsSectionRef {
  id: string;
  label: string;
}

export interface SettingsCategory {
  id: SettingsTab;
  label: string;
  /** one line under the page title */
  description: string;
  icon: IconComponent;
  /** the titled blocks of its page, in page order; the sidebar lists them under the open category */
  sections?: SettingsSectionRef[];
  adminOnly?: boolean;
}

export interface SettingsGroup {
  label: string;
  categories: SettingsCategory[];
}

// One catalog feeds the desktop sidebar and the compact index, so the two can't
// drift apart. Ids are the public URLs (/app/settings/:id): labels can change,
// ids can't.
export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    label: 'Você',
    categories: [
      { id: 'profile', label: 'Perfil', description: 'Edite direto no seu perfil. O que você vê aqui é exatamente o que os outros vão ver.', icon: UserIcon },
      { id: 'account', label: 'Minha conta', description: 'Identificação, e-mail, armazenamento e sessão.', icon: IdentificationCardIcon,
        sections: [{ id: 'identity', label: 'Identificação' }, { id: 'email', label: 'E-mail' }, { id: 'storage', label: 'Armazenamento de anexos' }, { id: 'session', label: 'Sessão' }] },
      { id: 'privacy', label: 'Privacidade', description: 'Quem você bloqueou e o que isso muda.', icon: LockIcon },
    ],
  },
  {
    label: 'Aplicativo',
    categories: [
      { id: 'av', label: 'Áudio e vídeo', description: 'Dispositivos e o processamento do seu microfone.', icon: SlidersIcon,
        sections: [{ id: 'microphone', label: 'Entrada de áudio' }, { id: 'speaker', label: 'Saída de áudio' }, { id: 'camera', label: 'Vídeo' }] },
      { id: 'notifications', label: 'Notificações', description: 'Avisos do sistema e sons do app.', icon: BellIcon,
        sections: [{ id: 'system', label: 'Notificações do sistema' }, { id: 'sounds', label: 'Sons' }] },
      { id: 'prefs', label: 'Preferências', description: 'Como a chamada aparece e como imagens são enviadas. Vale só neste navegador e não acompanha a conta entre dispositivos.', icon: SlidersIcon,
        sections: [{ id: 'app-appearance', label: 'Aparência do app' }, { id: 'call-appearance', label: 'Aparência da chamada' }, { id: 'image-uploads', label: 'Envio de imagens' }] },
    ],
  },
  {
    label: 'Administração',
    categories: [
      { id: 'moderation', label: 'Administração', description: 'Acesso à área administrativa da instância.', icon: ShieldCheckIcon, adminOnly: true },
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
