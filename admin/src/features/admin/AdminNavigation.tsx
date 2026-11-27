import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router';
import { MenuIcon } from '@/shared/ui/icons';
import { Button } from '@/shared/ui/primitives/button';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/shared/ui/primitives/dialog';
import { ADMIN_GROUPS, adminSectionPath } from './adminCatalog';

export function AdminNavigation({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation('admin');
  return (
    <nav aria-label={t('layout.navigation')} className="flex min-w-0 flex-col gap-5">
      {ADMIN_GROUPS.map((group) => (
        <div key={group.labelKey ?? 'overview'}>
          {group.labelKey && <p className="mb-1.5 px-3 text-micro font-semibold tracking-[0.06em] text-text-muted uppercase">{t(group.labelKey)}</p>}
          <ul className="grid gap-0.5">
            {group.sections.map((section) => {
              const Icon = section.icon;
              return (
                <li key={section.id}>
                  <NavLink to={adminSectionPath(section)} end={section.id === 'overview'} onClick={onNavigate} className="admin-nav-link focus-ring">
                    <Icon size={17} aria-hidden className="shrink-0" />
                    <span className="truncate">{t(section.labelKey)}</span>
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function AdminMobileNavigation() {
  const { t } = useTranslation('admin');
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="icon" aria-label={t('layout.openNavigation')} />}>
        <MenuIcon aria-hidden />
      </DialogTrigger>
      <DialogContent className="admin-nav-drawer">
        <DialogTitle className="mb-5 px-3 pr-10">{t('layout.title')}</DialogTitle>
        <AdminNavigation onNavigate={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
