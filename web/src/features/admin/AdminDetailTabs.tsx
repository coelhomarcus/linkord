import { useLocation } from 'react-router';
import { cn } from '@/shared/lib/utils';
import { AppLink } from '@/shared/ui/app-link';

export interface DetailTab<T extends string> { id: T; label: string }

/** Sub-sections of a detail page, each with its own URL (`?tab=`), so a link or a
 * reload lands on it. They are links, not a widget with its own state: the URL
 * is the only source of truth. The row scrolls sideways on its own when the
 * width runs out — never the page. */
export function AdminDetailTabs<T extends string>({ label, tabs, active, defaultTab }: {
  label: string;
  tabs: DetailTab<T>[];
  active: T;
  defaultTab: T;
}) {
  const { pathname, state } = useLocation();
  return (
    <nav aria-label={label} className="scrollbar-none -mx-1 overflow-x-auto px-1">
      {/* the rule under the row is an inset shadow, like the profile's tabs, so the active bar sits on it */}
      <ul className="flex min-w-max gap-5 shadow-[inset_0_-1px_0_var(--color-border)]">
        {tabs.map((tab) => {
          const current = tab.id === active;
          return (
            <li key={tab.id}>
              <AppLink
                // the list the admin came from travels with every tab, so "back" still knows it
                to={{ pathname, search: tab.id === defaultTab ? '' : `?tab=${tab.id}` }}
                state={state}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'flex h-11 items-center border-b-2 text-body font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                  current ? 'border-text-primary text-text-primary' : 'border-transparent text-text-muted hover:text-text-secondary',
                )}
              >
                {tab.label}
              </AppLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
