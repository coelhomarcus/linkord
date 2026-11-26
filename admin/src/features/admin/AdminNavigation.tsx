import { CaretRightIcon, iconWeight } from '@overcord/frontend-shared/ui/icons';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router';
import { cn } from '@overcord/frontend-shared/lib/utils';
import { ActiveFill } from '@overcord/frontend-shared/ui/active-fill';
import { ADMIN_GROUPS, adminSectionPath } from './adminCatalog';

function GroupLabel({ children }: { children: string }) {
  return <p className="truncate px-2.5 pb-1.5 text-label font-medium text-text-muted">{children}</p>;
}

/** The permanent section sidebar of a wide admin area, drawn like the settings' own. A detail page keeps
 * its section marked: NavLink matches by path prefix. */
export function AdminSidebar() {
  const { t } = useTranslation('admin');
  return (
    <nav aria-label={t('layout.title')} className="flex w-[218px] flex-none flex-col gap-5 px-4 py-6">
      {ADMIN_GROUPS.map((group) => (
        <div key={group.labelKey} className="flex flex-col">
          <GroupLabel>{t(group.labelKey as never)}</GroupLabel>
          {group.sections.map((section) => {
            const Icon = section.icon;
            return (
              <NavLink
                key={section.id}
                to={adminSectionPath(section)}
                className={({ isActive }) => cn(
                  'relative isolate mb-0.5 flex h-10 flex-none items-center gap-2.5 rounded-lg px-2.5 text-body font-medium focus-ring',
                  isActive ? 'text-accent-text' : 'text-text-secondary hover:bg-nav-hover hover:text-text-primary',
                )}
              >
                {({ isActive }) => (
                  <>
                    {isActive && <ActiveFill className="rounded-lg" />}
                    <Icon size={18} weight={iconWeight(isActive)} aria-hidden className="flex-none" />
                    <span className="truncate">{t(section.labelKey as never)}</span>
                  </>
                )}
              </NavLink>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

/** The compact landing screen: the same groups, icons and labels as the sidebar, one full-width row each. */
export function AdminIndex() {
  const { t } = useTranslation('admin');
  return (
    <nav aria-label={t('layout.title')} className="flex flex-col">
      <h1 className="mb-4 text-display font-semibold text-text-strong">{t('layout.title')}</h1>
      <div className="flex flex-col gap-1">
        {ADMIN_GROUPS.map((group) => (
          <div key={group.labelKey} className="flex flex-col gap-0.5 pt-4 first:pt-0">
            <GroupLabel>{t(group.labelKey as never)}</GroupLabel>
            {group.sections.map((section) => {
              const Icon = section.icon;
              return (
                <NavLink
                  key={section.id}
                  to={adminSectionPath(section)}
                  className="flex min-h-11 items-center gap-3 rounded-md px-2.5 text-body font-medium text-text-primary focus-ring hover:bg-nav-hover"
                >
                  <Icon size={20} aria-hidden className="flex-none text-text-muted" />
                  <span className="min-w-0 flex-1 truncate">{t(section.labelKey as never)}</span>
                  <CaretRightIcon size={16} aria-hidden className="flex-none text-text-muted" />
                </NavLink>
              );
            })}
          </div>
        ))}
      </div>
    </nav>
  );
}
