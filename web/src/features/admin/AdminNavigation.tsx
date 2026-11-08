import { CaretRightIcon, ShieldCheckIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router';
import { cn } from '@/shared/lib/utils';
import { ActiveFill } from '@/shared/ui/active-fill';
import { iconWeight } from '@/shared/ui/icons';
import { ADMIN_GROUPS, adminSectionPath } from './adminCatalog';

function GroupLabel({ children }: { children: string }) {
  return <p className="truncate px-2.5 pb-1.5 text-label font-medium text-text-muted">{children}</p>;
}

/** What this area is, at the top of the list, where the settings show who you are. */
function AreaCard() {
  const { t } = useTranslation('admin');
  return (
    <div className="mb-3 flex flex-none items-center gap-3 rounded-lg border border-border bg-fill-subtle p-2.5">
      <span aria-hidden className="grid size-10 flex-none place-items-center rounded-full bg-primary/15 text-accent-text">
        <ShieldCheckIcon size={22} weight="fill" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-semibold text-text-primary">{t('layout.title')}</span>
        <span className="block truncate text-caption text-text-muted">{t('layout.subtitle')}</span>
      </span>
    </div>
  );
}

/** The permanent section sidebar of a wide admin area, drawn like the settings' own. A detail page keeps
 * its section marked: NavLink matches by path prefix. */
export function AdminSidebar() {
  const { t } = useTranslation('admin');
  return (
    <nav aria-label={t('layout.title')} className="flex w-[218px] flex-none flex-col px-3 py-6">
      <AreaCard />
      {ADMIN_GROUPS.map((group, index) => (
        <div key={group.labelKey} className="flex flex-col">
          {index > 0 && <span aria-hidden className="mx-2.5 my-2 h-px flex-none bg-border-subtle" />}
          <GroupLabel>{t(group.labelKey as never)}</GroupLabel>
          {group.sections.map((section) => {
            const Icon = section.icon;
            return (
              <NavLink
                key={section.id}
                to={adminSectionPath(section)}
                className={({ isActive }) => cn(
                  'relative isolate mb-0.5 flex h-8 flex-none items-center gap-2 rounded-lg px-2.5 text-body font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  isActive ? 'text-text-strong' : 'text-text-secondary hover:bg-nav-hover hover:text-text-primary',
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
      <AreaCard />
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
                  className="flex min-h-11 items-center gap-3 rounded-md px-2.5 text-body font-medium text-text-primary outline-none hover:bg-nav-hover focus-visible:ring-2 focus-visible:ring-ring"
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
